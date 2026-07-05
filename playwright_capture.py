"""
使用 Playwright 捕获闲鱼 Web 版 API 流量
==========================================
通过浏览器自动化操作 goofish.com，拦截所有API请求/响应，
发现闲鱼的 MTOP API 端点。

用法:
  python playwright_capture.py
  python playwright_capture.py --headless   # 无头模式
  python playwright_capture.py --export captured_data.jsonl  # 指定输出
"""

import sys
import json
import os
import re
import time
from datetime import datetime
from urllib.parse import urlparse, parse_qs

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("请安装 Playwright: pip install playwright && playwright install chromium")
    sys.exit(1)


# ============================================================
#  配置
# ============================================================
HOME_URL = 'https://www.goofish.com/'
SEARCH_URL = 'https://www.goofish.com/search?q='
DETAIL_URL = 'https://www.goofish.com/item/'
KEYWORDS = ['手机', '耳机', '电脑', '相机']
OUTPUT_FILE = 'web_captured_apis.jsonl'

# 感兴趣的API模式
API_PATTERNS = [
    'mtop.', 'pc.search', 'pc.detail', 'item.detail',
    'user.seller', 'user.items', 'shop.', 'store.',
    'comment.', 'evaluate', 'favor', 'collect',
]


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}')
    sys.stdout.flush()


def should_capture(url, path):
    """判断是否是需要捕获的API"""
    url_lower = url.lower()
    path_lower = path.lower()
    
    # 排除静态资源
    static_exts = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', 
                   '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot',
                   '.webp', '.mp4', '.wasm']
    for ext in static_exts:
        if path_lower.endswith(ext):
            return False
    
    # 目标域名
    target_domains = ['goofish.com', 'taobao.com', 'mtop']
    if not any(d in url_lower for d in target_domains):
        return False
    
    # API关键词匹配
    if any(p in url_lower for p in API_PATTERNS):
        return True
    
    # MTOP JSONP响应
    if 'mtopjsonp' in url_lower:
        return True
    
    # API路径
    if '/h5/' in path or '/api/' in path or '/rest/' in path:
        return True
    
    return False


def parse_mtop_response(text):
    """解析 MTOP JSONP"""
    if not text:
        return None
    
    jsonp_match = re.match(r'^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$', text, re.DOTALL)
    if jsonp_match:
        try:
            return json.loads(jsonp_match.group(1))
        except:
            pass
    
    try:
        return json.loads(text)
    except:
        pass
    
    return None


def extract_5dim(data):
    """提取5维数据"""
    result = {}
    if not data or not isinstance(data, dict):
        return result
    
    item = data.get('itemDO', data.get('item', {}))
    if isinstance(item, dict):
        for key in ['browseCnt', 'wantCnt', 'collectCnt', 'interactFavorCnt', 'evaluateCnt']:
            if key in item:
                result[key] = item[key]
        result['title'] = item.get('title', '')[:60]
        result['itemId'] = item.get('itemId', '')
        result['price'] = item.get('soldPrice', item.get('minPrice', ''))
    
    # 搜索列表
    if 'resultList' in data and isinstance(data['resultList'], list):
        result['searchResults'] = len(data['resultList'])
    
    return result


class APICapture:
    """API 捕获器"""
    
    def __init__(self):
        self.records = []
        self.api_counts = {}
        self.captured_items = []
        self.found_item_ids = set()
    
    def add_record(self, record, raw_data=None):
        self.records.append(record)
        api_name = record.get('api_name', 'unknown')
        self.api_counts[api_name] = self.api_counts.get(api_name, 0) + 1
        # 从activate API的cardList中提取itemId
        if raw_data and isinstance(raw_data, dict):
            data = raw_data.get('data', {})
            if isinstance(data, dict):
                card_list = data.get('cardList', [])
                if card_list and isinstance(card_list, list):
                    for card in card_list:
                        if isinstance(card, dict):
                            item_id = card.get('itemId') or card.get('id')
                            if item_id:
                                self.found_item_ids.add(str(item_id))
                            # 在一些结构中，itemId可能在嵌套中
                            data_node = card.get('data', {})
                            if isinstance(data_node, dict):
                                for key in ['itemId', 'id', 'objectId']:
                                    vid = data_node.get(key)
                                    if vid:
                                        self.found_item_ids.add(str(vid))
    
    def handle_response(self, response):
        """处理响应"""
        url = response.url
        path = urlparse(url).path
        
        if not should_capture(url, path):
            return
        
        try:
            body = response.text()
        except:
            body = ''
        
        parsed = parse_mtop_response(body)
        
        record = {
            'timestamp': datetime.now().isoformat(),
            'url': url[:200],
            'path': path[:100],
            'status': response.status,
        }
        
        if parsed:
            record['api_name'] = parsed.get('api', '') or parsed.get('api_name', '')
            record['ret'] = parsed.get('ret', [''])
            record['api_version'] = parsed.get('v', '')
            
            data = parsed.get('data', {})
            if data:
                dim5 = extract_5dim(data)
                if dim5:
                    record['5dim'] = dim5
                    if 'itemId' in dim5 and dim5['itemId']:
                        self.captured_items.append(dim5)
                record['data_keys'] = list(data.keys())[:15]
            
            # 打印摘要
            dim5_str = ''
            if '5dim' in record:
                d = record['5dim']
                parts = []
                for k, v in d.items():
                    if k in ('browseCnt', 'wantCnt', 'collectCnt', 'interactFavorCnt', 'evaluateCnt') and v:
                        parts.append(f'{k}={v}')
                if parts:
                    dim5_str = ' | ' + ' '.join(parts)
            
            item_title = record.get('5dim', {}).get('title', '')
            log(f'  📥 API={record["api_name"][:45]:45s} {item_title}{dim5_str}')
        else:
            log(f'  📥 {response.status} {path[:60]}')
        
        self.add_record(record, parsed)
    
    def print_summary(self):
        """打印汇总"""
        print()
        print('=' * 60)
        print('  📊 捕获汇总')
        print('=' * 60)
        print(f'  总记录数: {len(self.records)}')
        print(f'  捕获商品: {len(self.captured_items)}')
        print()
        print(f'  📋 发现的API端点 ({len(self.api_counts)}个):')
        print(f'  {"API名称":55s} {"次数":>5s}')
        print(f'  {"-"*55} {"-"*5}')
        for api, count in sorted(self.api_counts.items(), key=lambda x: -x[1]):
            marker = ' ✅' if any(v.get('5dim') for v in self.records if v.get('api_name') == api) else ''
            print(f'  {api[:55]:55s} {count:>5d}{marker}')
        
        print()
        if self.captured_items:
            print(f'  📦 捕获的商品数据:')
            for item in self.captured_items[:5]:
                title = item.get('title', '')[:40]
                item_id = item.get('itemId', '')
                dims = {k: v for k, v in item.items() 
                       if k in ('browseCnt', 'wantCnt', 'collectCnt', 'interactFavorCnt', 'evaluateCnt') and v}
                print(f'    {item_id} | {title}')
                if dims:
                    print(f'      {dims}')
        
        print()
        print(f'  完整数据已保存到: {OUTPUT_FILE}')
    
    def save(self, filepath):
        """保存到JSONL"""
        with open(filepath, 'w', encoding='utf-8') as f:
            for r in self.records:
                f.write(json.dumps(r, ensure_ascii=False) + '\n')


def main():
    headless = '--headless' in sys.argv
    export_file = sys.argv[sys.argv.index('--export') + 1] if '--export' in sys.argv else OUTPUT_FILE
    
    print('=' * 55)
    print('  闲鱼 Web API 发现工具 (Playwright)')
    print('=' * 55)
    print(f'  headless: {headless}')
    print(f'  输出文件: {export_file}')
    print()
    
    cap = APICapture()
    
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=headless,
            args=['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
        )
        context = browser.new_context(
            viewport={'width': 1400, 'height': 900},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                       '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        page = context.new_page()
        
        # 监听响应
        page.on('response', lambda resp: cap.handle_response(resp))
        
        # 1. 首页
        log('🏠 访问首页...')
        page.goto(HOME_URL, wait_until='networkidle', timeout=30000)
        time.sleep(3)
        
        # 2. 搜索不同关键词
        for kw in KEYWORDS:
            search_url = SEARCH_URL + kw
            log(f'\n🔍 搜索: {kw}')
            log(f'    {search_url}')
            try:
                page.goto(search_url, wait_until='networkidle', timeout=30000)
                time.sleep(3)
                
                # 滚动页面加载更多
                for i in range(3):
                    page.evaluate('window.scrollBy(0, 800)')
                    time.sleep(1.5)
                
                log(f'    ✅ 搜索完成')
            except Exception as e:
                log(f'    ⚠️ 搜索出错: {e}')
        
        # 3. 打开搜索结果的商品详情页
        log(f'\n📦 从搜索结果提取到 {len(cap.found_item_ids)} 个商品ID，打开详情...')
        for i, item_id in enumerate(list(cap.found_item_ids)[:5]):
            detail_url = DETAIL_URL + item_id
            log(f'   [{i+1}/5] {detail_url}')
            try:
                page.goto(detail_url, wait_until='networkidle', timeout=30000)
                time.sleep(3)
            except Exception as e:
                log(f'    ⚠️ 详情出错: {e}')
        
        # 4. 尝试访问店铺
        log('\n🏪 尝试访问店铺...')
        seller_ids = set()
        for r in cap.records:
            if '5dim' in r:
                seller = r['5dim'].get('sellerId', '')
                if seller:
                    seller_ids.add(seller)
        
        if seller_ids:
            for sid in list(seller_ids)[:2]:
                shop_url = f'https://www.goofish.com/shop/{sid}'
                log(f'    {shop_url}')
                try:
                    page.goto(shop_url, wait_until='networkidle', timeout=30000)
                    time.sleep(3)
                except:
                    pass
        
        browser.close()
    
    # 汇总
    cap.save(export_file)
    cap.print_summary()


if __name__ == '__main__':
    main()
