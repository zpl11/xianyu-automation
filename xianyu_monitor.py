#!/usr/bin/env python3
"""
闲鱼统一监控系统 v3.0
=====================
基于已发现的 MTOP API 端点，提供完整的商品监控功能。

已发现和使用的 API:
  1. mtop.taobao.idlemtopsearch.pc.search          - 搜索商品列表
  2. mtop.taobao.idlemtopsearch.pc.item.search.activate - 搜索激活
  3. mtop.taobao.idle.pc.detail                     - 商品详情 (含5维数据)
  4. mtop.taobao.idlehome.home.webpc.feed           - 首页推荐流
  5. mtop.taobao.idlemessage.pc.loginuser.get       - 登录检查

功能:
  - 关键词搜索 + 商品监控
  - 5维数据采集 (浏览/想要/收藏/留言/评价)
  - 标题/价格变更检测
  - CSV/JSON导出 + 统计报告
  - Playwright 浏览器自动化 (自动处理Cookie/登录)

用法:
  首次:   python xianyu_monitor.py --login          # 登录闲鱼
  监控:    python xianyu_monitor.py --keyword=手机   # 搜索并监控
  店铺:    python xianyu_monitor.py --shop=店铺ID    # 监控店铺
  导出:    python xianyu_monitor.py --export         # 导出CSV
  报告:    python xianyu_monitor.py --report         # 统计报告

依赖:
  pip install playwright
  playwright install chromium
"""

import sys
import json
import os
import time
import re
import csv
from datetime import datetime, timedelta
from collections import Counter, defaultdict
from urllib.parse import urlencode

# Playwright
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("请安装 Playwright: pip install playwright && playwright install chromium")
    sys.exit(1)


# ============================================================
#  配置
# ============================================================
CONFIG = {
    'data_file': 'monitor_data.json',
    'export_dir': 'exports',
    'check_interval': 300,       # 默认监控间隔(秒)
    'max_items': 100,            # 最大跟踪商品数
    'viewport': {'width': 1400, 'height': 900},
    'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

# MTOP API 配置
MTOP_CONFIG = {
    'base_url': 'https://h5api.m.goofish.com/h5',
    'app_key': '34839810',
    'version': '1.0',
}

# 已知API端点
API = {
    'search': 'mtop.taobao.idlemtopsearch.pc.search',
    'search_activate': 'mtop.taobao.idlemtopsearch.pc.item.search.activate',
    'search_shade': 'mtop.taobao.idlemtopsearch.pc.search.shade',
    'detail': 'mtop.taobao.idle.pc.detail',
    'home_feed': 'mtop.taobao.idlehome.home.webpc.feed',
    'login_check': 'mtop.taobao.idlemessage.pc.loginuser.get',
    'user_nav': 'mtop.idle.web.user.page.nav',
    'index_get': 'mtop.gaia.nodejs.gaia.idle.data.gw.v2.index.get',
}


# ============================================================
#  工具函数
# ============================================================

def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] [{level}] {msg}')
    sys.stdout.flush()


def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path)


def parse_mtop(text):
    """解析 MTOP JSONP 响应"""
    if not text:
        return None
    m = re.match(r'^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$', text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except:
            pass
    try:
        return json.loads(text)
    except:
        return None


# ============================================================
#  数据存储
# ============================================================

class DataStore:
    """JSON文件数据存储，带变更检测和历史追踪"""
    
    def __init__(self, filepath):
        self.filepath = filepath
        self.data = self._load()
    
    def _load(self):
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass
        return {'items': {}, 'changes': [], 'config': {}}
    
    def save(self):
        ensure_dir(os.path.dirname(self.filepath) or '.')
        with open(self.filepath, 'w', encoding='utf-8') as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)
    
    def get_item(self, item_id):
        return self.data['items'].get(str(item_id))
    
    def update_item(self, item_id, new_data):
        """更新商品数据，检测变更"""
        item_id = str(item_id)
        now = datetime.now().isoformat()
        
        if item_id not in self.data['items']:
            # 新商品
            self.data['items'][item_id] = {
                'itemId': item_id,
                'title': new_data.get('title', ''),
                'price': new_data.get('price', ''),
                'url': f'https://www.goofish.com/item/{item_id}',
                'firstSeen': now,
                'lastSeen': now,
                'checkCount': 0,
                'history': [],
                'changes': [],
            }
            self.add_change(item_id, 'NEW', '新商品上架')
        
        item = self.data['items'][item_id]
        item['lastSeen'] = now
        item['checkCount'] = item.get('checkCount', 0) + 1
        
        # 检测标题变更
        old_title = item.get('title', '')
        new_title = new_data.get('title', '')
        if old_title and new_title and old_title != new_title:
            self.add_change(item_id, 'TITLE_CHANGE',
                          f'标题变更: "{old_title[:30]}" → "{new_title[:30]}"')
        
        # 检测价格变更
        old_price = item.get('price', '')
        new_price = new_data.get('price', '')
        if old_price and new_price and old_price != new_price:
            self.add_change(item_id, 'PRICE_CHANGE',
                          f'价格变更: {old_price} → {new_price}')
        
        # 更新字段
        for key in ['title', 'price', 'sellerName', 'sellerId', 'location']:
            if key in new_data and new_data[key]:
                item[key] = new_data[key]
        
        # 记录历史（5维数据）
        history_entry = {
            'timestamp': now,
            'title': new_title or item.get('title', ''),
            'price': new_price or item.get('price', ''),
        }
        for dim in ['views', 'wants', 'favorites', 'comments', 'reviews']:
            if dim in new_data:
                history_entry[dim] = new_data[dim]
                old_val = item.get(dim)
                if old_val is not None and new_data[dim] != old_val:
                    self.add_change(item_id, 'STATS_CHANGE',
                                  f'{dim}: {old_val} → {new_data[dim]}')
                item[dim] = new_data[dim]
        
        item['history'].append(history_entry)
        
        # 限制历史记录数量
        if len(item['history']) > 200:
            item['history'] = item['history'][-200:]
        
        self.save()
        return True
    
    def add_change(self, item_id, change_type, message):
        self.data['changes'].append({
            'timestamp': datetime.now().isoformat(),
            'itemId': item_id,
            'type': change_type,
            'message': message,
        })
        # 限制变更记录数
        if len(self.data['changes']) > 1000:
            self.data['changes'] = self.data['changes'][-1000:]
        
        # 也保存到商品自身的变更列表
        item = self.data['items'].get(str(item_id))
        if item:
            if 'changes' not in item:
                item['changes'] = []
            item['changes'].append({
                'timestamp': datetime.now().isoformat(),
                'type': change_type,
                'message': message,
            })
    
    def export_csv(self, filepath):
        """导出为CSV"""
        ensure_dir(os.path.dirname(filepath) or '.')
        fields = ['itemId', 'title', 'price', 'views', 'wants', 'favorites',
                  'comments', 'reviews', 'sellerName', 'firstSeen', 'lastSeen',
                  'checkCount', 'url']
        
        with open(filepath, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            for item_id, item in self.data['items'].items():
                row = {k: item.get(k, '') for k in fields}
                writer.writerow(row)
        
        log(f'📤 已导出 {len(self.data["items"])} 条数据到 {filepath}')
    
    def export_json(self, filepath):
        """导出为JSON"""
        ensure_dir(os.path.dirname(filepath) or '.')
        export_data = []
        for item_id, item in self.data['items'].items():
            export_data.append({
                'itemId': item_id,
                'title': item.get('title', ''),
                'price': item.get('price', ''),
                'views': item.get('views', 0),
                'wants': item.get('wants', 0),
                'favorites': item.get('favorites', 0),
                'comments': item.get('comments', 0),
                'reviews': item.get('reviews', 0),
                'sellerName': item.get('sellerName', ''),
                'url': item.get('url', ''),
                'firstSeen': item.get('firstSeen', ''),
                'lastSeen': item.get('lastSeen', ''),
                'history': item.get('history', []),
            })
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(export_data, f, ensure_ascii=False, indent=2)
        
        log(f'📤 已导出 {len(export_data)} 条数据到 {filepath}')
    
    def print_report(self):
        """打印统计报告"""
        items = self.data['items']
        changes = self.data['changes']
        
        print()
        print('=' * 60)
        print('  📊 闲鱼监控统计报告')
        print(f'  {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
        print('=' * 60)
        print(f'  跟踪商品数: {len(items)}')
        print(f'  变更事件数: {len(changes)}')
        print()
        
        if not items:
            print('  📭 暂无数据')
            print()
            return
        
        # 按浏览数排序 TOP10
        print(f'  🔥 热门商品 TOP 10')
        print(f'  {"#":>3s} {"标题":35s} {"浏览":>6s} {"想要":>6s} {"收藏":>6s} {"留言":>6s}')
        print(f'  {"-"*3} {"-"*35} {"-"*6} {"-"*6} {"-"*6} {"-"*6}')
        
        sorted_items = sorted(items.values(),
                            key=lambda x: int(x.get('views', 0) or 0), reverse=True)
        for i, item in enumerate(sorted_items[:10]):
            title = (item.get('title', '') or '')[:35]
            views = item.get('views', 0) or 0
            wants = item.get('wants', 0) or 0
            favs = item.get('favorites', 0) or 0
            comm = item.get('comments', 0) or 0
            print(f'  {i+1:>3d} {title:35s} {views:>6d} {wants:>6d} {favs:>6d} {comm:>6d}')
        
        print()
        
        # 最近变更
        if changes:
            print(f'  📝 最近变更 (最新5条)')
            for change in changes[-5:]:
                ts = change.get('timestamp', '')[-19:-7]
                print(f'  [{ts}] [{change["type"]}] {change["message"]}')
        
        print()
        
        # 统计摘要
        total_views = sum(int(item.get('views', 0) or 0) for item in items.values())
        total_wants = sum(int(item.get('wants', 0) or 0) for item in items.values())
        avg_views = total_views // len(items) if items else 0
        avg_wants = total_wants // len(items) if items else 0
        
        print(f'  📈 统计摘要')
        print(f'  总浏览: {total_views:,}')
        print(f'  总想要: {total_wants:,}')
        print(f'  平均浏览: {avg_views:,}')
        print(f'  平均想要: {avg_wants:,}')
        
        # 变更统计
        change_types = Counter(c['type'] for c in changes)
        print(f'  变更统计: {dict(change_types)}')
        
        print()
        print(f'  💡 导出命令: python {sys.argv[0]} --export')
        print(f'  💡 持续监控: python {sys.argv[0]} --keyword=关键词 --interval=300')
        print('=' * 60)
        print()


# ============================================================
#  闲鱼监控器
# ============================================================

class XianyuMonitor:
    """闲鱼统一监控器"""
    
    def __init__(self, data_store=None):
        self.store = data_store or DataStore(CONFIG['data_file'])
        self.api_data = {}  # 缓存当前API数据
        self.browser = None
        self.context = None
        self.page = None
    
    def start_browser(self, headless=True, persistent_dir='browser_data'):
        """启动Playwright浏览器"""
        log('🚀 启动浏览器...')
        self.playwright = sync_playwright().start()
        
        # 使用持久化上下文（保存Cookie/登录状态）
        ensure_dir(persistent_dir)
        self.context = self.playwright.chromium.launch_persistent_context(
            user_data_dir=persistent_dir,
            headless=headless,
            viewport=CONFIG['viewport'],
            user_agent=CONFIG['user_agent'],
            args=['--disable-web-security', '--no-sandbox'],
        )
        self.page = self.context.new_page()
        
        # 监听API响应
        self.page.on('response', self._on_response)
        log('✅ 浏览器已启动')
    
    def close_browser(self):
        """关闭浏览器"""
        if self.context:
            self.context.close()
        if self.playwright:
            self.playwright.stop()
        log('浏览器已关闭')
    
    def _on_response(self, response):
        """监听API响应"""
        url = response.url
        path = response.url.split('?')[0]
        
        # 只捕获MTOP API
        if 'h5api.m.goofish.com/h5/mtop.' not in url:
            return
        
        try:
            body = response.text()
        except:
            return
        
        parsed = parse_mtop(body)
        if not parsed:
            return
        
        api_name = parsed.get('api', '')
        ret = parsed.get('ret', [''])[0]
        data = parsed.get('data', {})
        
        if not api_name or not data:
            return
        
        # 缓存API数据
        self.api_data[api_name] = {
            'ret': ret,
            'data': data,
            'timestamp': datetime.now().isoformat(),
        }
        
        # 详情API - 提取5维数据
        if 'pc.detail' in api_name or 'detail' in api_name:
            self._process_detail(data)
        
        # 搜索API - 提取商品列表
        elif 'pc.search' in api_name:
            self._process_search(data)
        
        # 首页Feed - 提取推荐商品
        elif 'home.webpc.feed' in api_name:
            self._process_feed(data)
    
    def _process_detail(self, data):
        """处理详情API响应"""
        item_do = data.get('itemDO', data.get('item', {}))
        if not isinstance(item_do, dict):
            return
        
        item_id = str(item_do.get('itemId', ''))
        if not item_id:
            return
        
        dim5 = {
            'itemId': item_id,
            'title': (item_do.get('title', '') or '').strip(),
            'price': item_do.get('soldPrice', item_do.get('minPrice', '')),
            'views': int(item_do.get('browseCnt', 0) or 0),
            'wants': int(item_do.get('wantCnt', 0) or 0),
            'favorites': int(item_do.get('collectCnt', 0) or 0),
            'comments': int(item_do.get('interactFavorCnt', 0) or 0),
            'reviews': int(item_do.get('evaluateCnt', 0) or 0),
        }
        
        # 卖家信息
        seller = data.get('sellerDO', {})
        if isinstance(seller, dict):
            dim5['sellerName'] = seller.get('nick', '')
            dim5['sellerId'] = str(seller.get('sellerId', ''))
        
        log(f'  📊 商品: {dim5["title"][:30]} | '
            f'浏览={dim5["views"]} 想要={dim5["wants"]} '
            f'收藏={dim5["favorites"]} 留言={dim5["comments"]}')
        
        self.store.update_item(item_id, dim5)
    
    def _process_search(self, data):
        """处理搜索API响应"""
        result_list = data.get('resultList', [])
        if not isinstance(result_list, list):
            return
        
        log(f'  🔍 搜索结果: {len(result_list)} 个商品')
        
        for item_data in result_list:
            if not isinstance(item_data, dict):
                continue
            
            # 尝试多种路径提取商品信息
            item_main = (item_data.get('data', {}) or {}).get('item', {}) or {}
            main = item_main.get('main', {}) or {}
            click_param = (main.get('clickParam', {}) or {})
            args = click_param.get('args', {}) or {}
            ex = main.get('exContent', {}) or {}
            
            item_id = str(args.get('id', args.get('item_id', '')))
            if not item_id:
                continue
            
            title = ''
            if isinstance(ex.get('richTitle'), list):
                title = ''.join(t.get('data', {}).get('text', '') for t in ex['richTitle'])
            if not title:
                title = args.get('title', '')
            
            self.store.update_item(item_id, {
                'itemId': item_id,
                'title': title,
                'price': args.get('price', args.get('displayPrice', '')),
                'wants': int(args.get('wantNum', 0) or 0),
                'views': int(args.get('browseCnt', args.get('viewCount', 0)) or 0),
                'favorites': int(args.get('collectNum', 0) or 0),
                'sellerName': args.get('nick', ''),
                'location': args.get('city', ''),
            })
    
    def _process_feed(self, data):
        """处理首页Feed API"""
        # Feed API数据结构可能不同
        if isinstance(data, dict):
            items = data.get('list', data.get('items', data.get('data', [])))
            if isinstance(items, list):
                log(f'  🏠 Feed: {len(items)} 个推荐')
    
    # ========== 公开接口 ==========
    
    def check_login(self):
        """检查登录状态"""
        log('检查登录状态...')
        self.page.goto('https://www.goofish.com/',
                       wait_until='networkidle', timeout=30000)
        time.sleep(3)
        
        login_data = self.api_data.get(API['login_check'], {})
        if login_data.get('ret', '').startswith('SUCCESS'):
            log('✅ 已登录')
            return True
        else:
            log('⚠️ 未登录，需要进行登录')
            return False
    
    def login(self):
        """交互式登录"""
        log('🔑 打开登录页面...')
        self.page.goto('https://www.goofish.com/', wait_until='networkidle')
        log('请在浏览器中手动登录闲鱼')
        log('登录完成后按 Enter 继续...')
        input()
        log('✅ 登录完成')
    
    def search(self, keyword, pages=1):
        """搜索商品并采集数据"""
        log(f'\n🔍 搜索: "{keyword}" (pages={pages})')
        url = f'https://www.goofish.com/search?q={keyword}'
        
        try:
            self.page.goto(url, wait_until='networkidle', timeout=30000)
            time.sleep(2)
        except:
            time.sleep(5)
        
        # 滚动加载更多
        for i in range(pages * 3):
            self.page.evaluate('window.scrollBy(0, 800)')
            time.sleep(1)
        
        log(f'✅ 搜索完成')
    
    def open_detail(self, item_id):
        """打开商品详情页"""
        url = f'https://www.goofish.com/item/{item_id}'
        log(f'  📄 详情: {url}')
        try:
            self.page.goto(url, wait_until='networkidle', timeout=30000)
            time.sleep(2)
            return True
        except:
            log(f'  ⚠️ 详情加载失败')
            return False
    
    def monitor_keyword(self, keyword, interval=300, pages=1, limit=50):
        """持续监控关键词"""
        log(f'\n{"="*50}')
        log(f'🚀 开始监控关键词: "{keyword}"')
        log(f'   间隔: {interval}秒 | 页数: {pages}')
        log(f'{"="*50}')
        
        self.search(keyword, pages)
        
        # 打开搜索结果中的商品详情获取5维数据
        items = list(self.store.data['items'].keys())
        log(f'已发现 {len(items)} 个商品，获取详情...')
        
        for item_id in items[:limit]:
            self.open_detail(item_id)
        
        # 导出
        self.export()
        self.store.print_report()
    
    def export(self):
        """导出数据"""
        ensure_dir(CONFIG['export_dir'])
        date_str = datetime.now().strftime('%Y%m%d_%H%M%S')
        self.store.export_csv(os.path.join(CONFIG['export_dir'], f'闲鱼监控_{date_str}.csv'))
        self.store.export_json(os.path.join(CONFIG['export_dir'], f'闲鱼监控_{date_str}.json'))
    
    def report(self):
        """打印统计报告"""
        self.store.print_report()


# ============================================================
#  主入口
# ============================================================

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='闲鱼统一监控系统 v3.0')
    parser.add_argument('--keyword', help='搜索关键词')
    parser.add_argument('--shop', help='店铺ID')
    parser.add_argument('--item', help='商品ID')
    parser.add_argument('--interval', type=int, default=CONFIG['check_interval'],
                       help=f'监控间隔(秒，默认{CONFIG["check_interval"]})')
    parser.add_argument('--pages', type=int, default=1, help='搜索页数')
    parser.add_argument('--limit', type=int, default=50, help='最大跟踪商品数')
    parser.add_argument('--login', action='store_true', help='登录闲鱼')
    parser.add_argument('--export', action='store_true', help='导出数据')
    parser.add_argument('--report', action='store_true', help='统计报告')
    parser.add_argument('--headless', action='store_true', help='无头模式')
    parser.add_argument('--data', default=CONFIG['data_file'], help=f'数据文件')
    
    args = parser.parse_args()
    
    # 仅导出/报告
    if args.export:
        store = DataStore(args.data)
        store.export_csv(os.path.join(CONFIG['export_dir'], f'闲鱼监控_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'))
        store.export_json(os.path.join(CONFIG['export_dir'], f'闲鱼监控_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'))
        return
    
    if args.report:
        store = DataStore(args.data)
        store.print_report()
        return
    
    # 启动监控
    store = DataStore(args.data)
    monitor = XianyuMonitor(store)
    
    try:
        monitor.start_browser(headless=args.headless)
        
        if args.login:
            monitor.login()
            return
        
        if args.item:
            monitor.open_detail(args.item)
            monitor.export()
            monitor.report()
        
        elif args.shop:
            log(f'🏪 店铺模式: {args.shop}')
            shop_url = f'https://www.goofish.com/shop/{args.shop}'
            monitor.page.goto(shop_url, wait_until='networkidle', timeout=30000)
            time.sleep(3)
            monitor.export()
            monitor.report()
        
        elif args.keyword:
            monitor.monitor_keyword(args.keyword, args.interval, args.pages, args.limit)
        
        else:
            parser.print_help()
    
    finally:
        monitor.close_browser()


if __name__ == '__main__':
    main()
