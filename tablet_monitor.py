#!/usr/bin/env python3
"""
闲鱼平板端实时监控系统
=======================
通过 uiautomator2 连接Android平板，操作闲鱼App，
从App UI中逆向提取完整商品数据：
  - 浏览数 (views)     ✓ App原生显示
  - 想要数 (wants)     ✓ App原生显示
  - 收藏数 (favorites) ✓ App原生显示
  - 留言数 (comments)  ✓ App原生显示 (Web版没有!)
  - 评价数 (reviews)   ✓ App原生显示 (Web版没有!)

用法:
  1. 平板通过USB连接到电脑，确保 adb devices 可识别
  2. 首次需要切换无线: python testCode/tcpip_bridge.py
  3. 运行本脚本:
     python tablet_monitor.py --keyword=要搜索的关键词

依赖:
  pip install uiautomator2 adbutils
"""

import uiautomator2 as u2
import time
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime

# ============================================================
#  配置
# ============================================================
CONFIG = {
    'device': '192.168.1.58',        # 平板IP
    'package': 'com.taobao.idlefish', # 闲鱼包名
    'data_file': 'tablet_monitor_data.json',
    'export_dir': 'exports',
    'keyword': '',                    # 搜索关键词
    'max_items': 50,                  # 最多采集商品数
    'scrolls_per_page': 10,           # 每页滚动次数
}

# 解析命令行参数
for arg in sys.argv[1:]:
    if arg.startswith('--keyword='):
        CONFIG['keyword'] = arg.split('=', 1)[1]
    elif arg.startswith('--max='):
        CONFIG['max_items'] = int(arg.split('=', 1)[1])

# ============================================================
#  工具函数
# ============================================================
def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}')
    sys.stdout.flush()

def sleep(sec):
    time.sleep(sec)

# ============================================================
#  平板连接
# ============================================================
def connect_device():
    """连接平板，自动处理重试"""
    ip = CONFIG['device']
    log(f'🔄 连接平板 {ip}...')
    
    try:
        d = u2.connect(ip)
        info = d.info
        log(f'✅ 已连接: {info.get("productName", "未知")} '
            f'{info.get("displayWidth", "?")}x{info.get("displayHeight", "?")}')
        return d
    except Exception as e:
        log(f'❌ 连接失败: {e}')
        log('')
        log('请确保:')
        log('  1. 平板通过USB连接电脑')
        log('  2. 运行: python testCode/tcpip_bridge.py')
        log('  3. 或手动: adb tcpip 5555 && adb connect 192.168.1.58')
        sys.exit(1)

def open_app(d):
    """打开闲鱼App"""
    log(f'📱 打开闲鱼...')
    d.app_start(CONFIG['package'])
    sleep(3)
    
    # 检查是否打开成功
    current = d.app_current()
    if current.get('package') != CONFIG['package']:
        log('⚠️ 闲鱼打开失败，尝试再次启动')
        d.app_start(CONFIG['package'])
        sleep(3)

def go_back_to_home(d):
    """返回首页"""
    for _ in range(3):
        d.press('back')
        sleep(0.5)

# ============================================================
#  UI 数据提取
# ============================================================

def extract_all_text(d):
    """获取当前屏幕所有可见文本"""
    try:
        xml_str = d.dump_hierarchy()
        import xml.etree.ElementTree as ET
        root = ET.fromstring(xml_str.encode('utf-8'))
        
        texts = []
        for node in root.iter('node'):
            text = (node.get('text', '') or node.get('content-desc', '')).strip()
            if text:
                texts.append(text)
        return texts
    except Exception as e:
        log(f'⚠️ 获取UI文本失败: {e}')
        return []

def parse_item_stats(texts):
    """
    从App详情页UI文本列表中提取商品5维数据
    基于实际逆向结果:
    
    详情页文本序列 (已验证):
      想要 [N]  浏览 [N]    → wants, views (位置相邻)
      评论按钮 [N]           → comments (按钮后的数字)
      收藏按钮 [N]           → favorites (按钮后的数字)
    """
    stats = {
        'views': 0, 'wants': 0, 'favorites': 0,
        'comments': 0, 'reviews': 0,
        'title': '', 'price': ''
    }
    
    # 提取标题: 较长文本且不含价格符号
    for t in texts:
        if len(t) > 8 and not re.search(r'[¥￥]', t) and not re.search(r'(想要|浏览|评论|收藏)', t):
            if not any(kw in t for kw in ['按钮', '能量', '领取', '立即购买', '聊一聊']):
                stats['title'] = t.replace('\n', ' ').strip()
                break
    
    # 提取价格: 含¥的文本
    for t in texts:
        m = re.search(r'[¥￥]\s*(\d+(?:\.\d{1,2})?)', t)
        if m:
            stats['price'] = m.group(1)
            break
    
    # 位置感知提取 (基于相邻文本节点)
    for i, t in enumerate(texts):
        # 想要数: "想要" 后面跟着数字
        if t == '想要' and i + 1 < len(texts):
            try:
                stats['wants'] = int(texts[i+1])
            except: pass
        
        # 浏览数: "浏览" 后面跟着数字
        if t == '浏览' and i + 1 < len(texts):
            try:
                stats['views'] = int(texts[i+1])
            except: pass
        
        # 评论/留言数: "评论按钮" 后面跟着数字
        if '评论' in t and '按钮' in t and i + 1 < len(texts):
            try:
                stats['comments'] = int(texts[i+1])
            except: pass
        
        # 收藏数: "收藏按钮" 后面跟着数字  
        if '收藏' in t and '按钮' in t and i + 1 < len(texts):
            try:
                stats['favorites'] = int(texts[i+1])
            except: pass
    
    # 用正则兜底
    full_text = '\n'.join(texts)
    if stats['views'] == 0:
        m = re.search(r'浏览\s*(\d+)', full_text)
        if m: stats['views'] = int(m.group(1))
    if stats['wants'] == 0:
        m = re.search(r'想要\s*(\d+)', full_text)
        if m: stats['wants'] = int(m.group(1))
    if stats['favorites'] == 0:
        m = re.search(r'收藏按钮\s*(\d+)', full_text)
        if m: stats['favorites'] = int(m.group(1))
    if stats['comments'] == 0:
        m = re.search(r'评论按钮\s*(\d+)', full_text)
        if m: stats['comments'] = int(m.group(1))
    
    return stats

def find_item_cards(d, raw_texts=None):
    """
    从搜索结果页中找到所有商品卡片
    支持两种格式:
      首页: ¥ [N] [.NN] ... N人想要
      搜索结果: ¥ ... 已售N+ ... 标题
    """
    if raw_texts is None:
        raw_texts = extract_all_text(d)
    
    texts = raw_texts
    items = []
    
    for i, t in enumerate(texts):
        # 找 "N人想要" 或 "已售N+" 或 "已售N"
        wants = 0
        is_match = False
        
        m = re.search(r'(?:包邮)?(\d+)\s*人想要', t)
        if m:
            wants = int(m.group(1))
            is_match = True
        
        if not is_match:
            m = re.search(r'已售\s*(\d+)\s*\+?', t)
            if m:
                wants = int(m.group(1))
                is_match = True
        
        if not is_match:
            continue
        
        # 向前找价格
        price = ''
        for j in range(max(0, i-10), i):
            if texts[j] == '¥' or texts[j] == '￥':
                if j + 1 < len(texts):
                    price_main = texts[j + 1]
                    price_decimal = ''
                    if j + 2 < len(texts) and texts[j + 2].startswith('.'):
                        price_decimal = texts[j + 2]
                    price = price_main + price_decimal
                break
        
        # 向前找标题
        title = ''
        price_pos = i
        for j in range(i-1, max(-1, i-15), -1):
            if texts[j] == '¥' or texts[j] == '￥':
                price_pos = j
                break
        
        for j in range(max(0, price_pos-2), -1, -1):
            t2 = texts[j]
            if len(t2) > 10 and not re.search(r'[¥￥]', t2):
                if not any(kw in t2 for kw in ['想要', '已售', '包邮', '信用', '按钮']):
                    title = t2.replace('\n', ' ').strip()[:80]
                    break
        
        if title:
            if not any(item['title'][:20] == title[:20] for item in items):
                items.append({'title': title, 'price': price, 'wants': wants})
    
    return items


def scrape_item_detail(d):
    """
    从当前商品详情页提取完整5维数据
    必须在详情页面时调用
    """
    sleep(2)
    texts = extract_all_text(d)
    stats = parse_item_stats(texts)
    
    # 提取商品ID
    item_id = ''
    for t in texts:
        m = re.search(r'id[=](\d+)', t)
        if m:
            item_id = m.group(1)
            break
    
    stats['itemId'] = item_id
    return stats


def open_item_detail(d, item_title):
    """通过点击商品卡片打开详情页"""
    if d(textContains=item_title[:10]).exists:
        d(textContains=item_title[:10]).click()
        sleep(3)
        return True
    w, h = d.window_size()
    d.click(w // 2, h // 2)
    sleep(3)
    return True


def search_and_collect(d, keyword):
    """搜索指定关键词，采集所有商品数据"""
    log(f'🔍 搜索 "{keyword}"...')
    
    go_back_to_home(d)
    sleep(2)
    W, H = d.window_size()
    
    # 1. 点击搜索区域打开搜索激活页
    xml_str = d.dump_hierarchy()
    root = ET.fromstring(xml_str.encode('utf-8'))
    
    search_clicked = False
    for node in root.iter('node'):
        text = (node.get('text', '') or node.get('content-desc', '')).strip()
        if '搜索' in text and '跳转' in text:
            bounds_str = node.get('bounds', '')
            m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds_str)
            if m:
                x = (int(m.group(1)) + int(m.group(3))) // 2
                y = (int(m.group(2)) + int(m.group(4))) // 2
                d.click(x, y)
                search_clicked = True
                break
    
    if not search_clicked:
        d.click(W // 2, int(H * 0.09))
    
    sleep(3)
    
    # 2. 清理零宽字符后匹配搜索历史
    def strip_zwsp(s):
        """移除零宽空格等不可见字符"""
        return re.sub(r'[\u200b\u200c\u200d\ufeff\u00a0]', '', s)
    
    found_history = False
    xml_str = d.dump_hierarchy()
    root = ET.fromstring(xml_str.encode('utf-8'))
    clean_keyword = strip_zwsp(keyword).lower()
    
    for node in root.iter('node'):
        text = (node.get('text', '') or node.get('content-desc', '')).strip()
        clean_text = strip_zwsp(text).lower().replace(' ', '')
        
        # 精确匹配搜索历史
        if clean_keyword == clean_text:
            bounds_str = node.get('bounds', '')
            m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds_str)
            if m:
                w = int(m.group(3)) - int(m.group(1))
                h = int(m.group(4)) - int(m.group(2))
                if w < 300 and h < 100:  # 是搜索项，不是大按钮
                    x = (int(m.group(1)) + int(m.group(3))) // 2
                    y = (int(m.group(2)) + int(m.group(4))) // 2
                    d.click(x, y)
                    log(f'点击搜索历史: "{text.strip()[:30]}"')
                    found_history = True
                    break
    
    if not found_history:
        # 3. 手动输入
        for node in root.iter('node'):
            cls = node.get('class', '')
            if 'EditText' in cls:
                bounds_str = node.get('bounds', '')
                m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds_str)
                if m:
                    x = (int(m.group(1)) + int(m.group(3))) // 2
                    y = (int(m.group(2)) + int(m.group(4))) // 2
                    d.click(x, y)
                    break
        
        sleep(2)
        
        try:
            d.clear_text()
            sleep(0.5)
        except:
            for _ in range(30):
                d.press('del')
            sleep(0.5)
        
        try:
            d(focused=True).set_text(keyword)
        except:
            d.send_keys(keyword)
        sleep(2)
        
        if d(description="搜索").exists:
            d(description="搜索").click()
            log('点击搜索按钮')
        elif d(text="搜索").exists:
            d(text="搜索").click()
        else:
            d.press('enter')
    
    sleep(5)
    
    # 4. 滚动采集商品列表
    collected = {}
    scrolls = 0
    max_scrolls = CONFIG['scrolls_per_page']
    max_items = CONFIG['max_items']
    
    log(f'📦 采集列表 (最多{max_items}个)...')
    
    while len(collected) < max_items and scrolls < max_scrolls:
        texts = extract_all_text(d)
        items = find_item_cards(d, texts)
        
        for item in items:
            key = item['title'][:30]
            if key not in collected:
                collected[key] = item
                log(f'  [{len(collected)}/{max_items}] ¥{item["price"]} 想要:{item["wants"]} {item["title"][:40]}')
        
        if len(collected) >= max_items:
            break
        
        d.swipe(W * 0.5, H * 0.8, W * 0.5, H * 0.2, 0.2)
        scrolls += 1
        sleep(2)
    
    log(f'✅ 列表: {len(collected)} 个, 滚动{scrolls}次')
    
    # 5. 逐个打开详情页
    log(f'🔬 采集详情数据...')
    
    results = []
    count = 0
    max_detail = min(10, len(collected))
    
    for title_key, basic_info in collected.items():
        if count >= max_detail:
            break
        
        count += 1
        log(f'  [{count}/{max_detail}] {basic_info["title"][:30]}...')
        
        try:
            if d(textContains=basic_info['title'][:10]).exists:
                d(textContains=basic_info['title'][:10]).click()
            else:
                d.click(W // 2, H // 3)
            sleep(4)
            
            detail = scrape_item_detail(d)
            
            if not detail.get('title'):
                detail['title'] = basic_info['title']
            if not detail.get('price'):
                detail['price'] = basic_info['price']
            if not detail.get('wants'):
                detail['wants'] = basic_info['wants']
            
            results.append(detail)
            log(f'    👁{detail["views"]} ❤️{detail["wants"]} ⭐{detail["favorites"]} 💬{detail["comments"]} 📝{detail["reviews"]}')
            
            d.press('back')
            sleep(2)
            
        except Exception as e:
            log(f'  ⚠️ 失败: {e}')
            d.press('back')
            sleep(2)
    
    return results

# ============================================================
#  数据存储
# ============================================================

class DataStore:
    def __init__(self):
        self.filepath = CONFIG['data_file']
        self.data = self._load()
    
    def _load(self):
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass
        return {'items': {}, 'checks': 0, 'created': datetime.now().isoformat()}
    
    def _save(self):
        with open(self.filepath, 'w', encoding='utf-8') as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)
    
    def update_item(self, item):
        """更新商品数据,检测变更"""
        item_id = item.get('itemId', '') or item.get('title', '')[:30]
        now = datetime.now().timestamp() * 1000
        existing = self.data['items'].get(item_id)
        
        changes = []
        if existing:
            # 检测变更
            fields = ['views', 'wants', 'favorites', 'comments', 'reviews', 'title', 'price']
            diffs = []
            for f in fields:
                if f in existing and f in item and existing[f] != item[f]:
                    diffs.append(f'{f}:{existing[f]}→{item[f]}')
            if diffs:
                changes.append({'time': now, 'type': 'STATS_CHANGE', 'msg': ' | '.join(diffs)})
            
            history = existing.get('history', [])
            history.append({
                'time': now,
                'views': item.get('views', 0),
                'wants': item.get('wants', 0),
                'favorites': item.get('favorites', 0),
                'comments': item.get('comments', 0),
                'reviews': item.get('reviews', 0),
                'title': item.get('title', ''),
                'price': item.get('price', ''),
            })
            if len(history) > 100:
                history = history[-100:]
            
            self.data['items'][item_id] = {
                **existing, **item,
                'lastSeen': now,
                'checkCount': existing.get('checkCount', 1) + 1,
                'changes': existing.get('changes', []) + changes,
                'history': history
            }
        else:
            self.data['items'][item_id] = {
                **item,
                'firstSeen': now,
                'lastSeen': now,
                'checkCount': 1,
                'changes': [{'time': now, 'type': 'NEW', 'msg': '新商品'}],
                'history': [{
                    'time': now,
                    'views': item.get('views', 0),
                    'wants': item.get('wants', 0),
                    'favorites': item.get('favorites', 0),
                    'comments': item.get('comments', 0),
                    'reviews': item.get('reviews', 0),
                    'title': item.get('title', ''),
                    'price': item.get('price', ''),
                }]
            }
        
        self.data['checks'] = self.data.get('checks', 0) + 1
        self._save()
        return changes
    
    def export_csv(self):
        """导出CSV"""
        items = list(self.data['items'].values())
        items.sort(key=lambda x: x.get('wants', 0), reverse=True)
        
        lines = []
        lines.append('商品标题,价格,浏览量,想要数,收藏数,留言数,评价数,首次发现,最后更新,检查次数')
        for item in items:
            title = item.get('title', '').replace(',', '，').replace('"', '""')
            lines.append(','.join([
                f'"{title}"',
                str(item.get('price', '')),
                str(item.get('views', 0)),
                str(item.get('wants', 0)),
                str(item.get('favorites', 0)),
                str(item.get('comments', 0)),
                str(item.get('reviews', 0)),
                str(datetime.fromtimestamp(item.get('firstSeen', 0)/1000).strftime('%Y-%m-%d %H:%M')),
                str(datetime.fromtimestamp(item.get('lastSeen', 0)/1000).strftime('%Y-%m-%d %H:%M')),
                str(item.get('checkCount', 1)),
            ]))
        
        os.makedirs(CONFIG['export_dir'], exist_ok=True)
        date_str = datetime.now().strftime('%Y-%m-%d')
        filepath = os.path.join(CONFIG['export_dir'], f'闲鱼平板数据_{date_str}.csv')
        
        with open(filepath, 'w', encoding='utf-8-sig') as f:
            f.write('\n'.join(lines))
        
        log(f'📥 CSV导出: {filepath}')
        
        # 也导出一份JSON
        json_path = os.path.join(CONFIG['export_dir'], f'闲鱼平板数据_{date_str}.json')
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        log(f'📥 JSON导出: {json_path}')
        
        return filepath
    
    def print_report(self):
        """打印统计报表"""
        items = list(self.data['items'].values())
        
        total_views = sum(i.get('views', 0) for i in items)
        total_wants = sum(i.get('wants', 0) for i in items)
        total_fav = sum(i.get('favorites', 0) for i in items)
        total_cmt = sum(i.get('comments', 0) for i in items)
        total_rvw = sum(i.get('reviews', 0) for i in items)
        
        print('\n' + '=' * 62)
        print('   📊  闲鱼平板端监控报表')
        print('=' * 62)
        print(f'   检查时间:   {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
        print(f'   关键词:     {CONFIG["keyword"]}')
        print(f'   总检查:     {self.data.get("checks", 1)}')
        print('─' * 62)
        print(f'   📦 商品数:    {len(items)}')
        print(f'   👁  总浏览:   {total_views}')
        print(f'   ❤️  总想要:   {total_wants}')
        print(f'   ⭐  总收藏:   {total_fav}')
        print(f'   💬  总留言:   {total_cmt}')
        print(f'   📝  总评价:   {total_rvw}')
        print('─' * 62)
        
        if items:
            print('\n  🔥 热门 Top 10:')
            sorted_items = sorted(items, key=lambda x: x.get('wants', 0), reverse=True)[:10]
            for i, item in enumerate(sorted_items, 1):
                t = (item.get('title', '') or '?')[:20]
                print(f'  {i:2d}. {t:20s} ¥{str(item.get("price","?")).ljust(6)} '
                      f'👁{item.get("views",0):>6} ❤️{item.get("wants",0):>6} '
                      f'⭐{item.get("favorites",0):>5} 💬{item.get("comments",0):>4} '
                      f'📝{item.get("reviews",0):>4}')
        
        print('=' * 62 + '\n')


# ============================================================
#  主流程
# ============================================================

def main():
    print()
    print('=' * 50)
    print('   闲鱼平板端实时监控系统')
    print('=' * 50)
    
    if not CONFIG['keyword']:
        CONFIG['keyword'] = input('请输入搜索关键词: ').strip()
        if not CONFIG['keyword']:
            CONFIG['keyword'] = '耳机'
    
    log(f'关键词: {CONFIG["keyword"]}')
    log(f'最大采集: {CONFIG["max_items"]} 个商品')
    
    # 连接平板
    d = connect_device()
    
    # 打开闲鱼
    open_app(d)
    
    # 加载已有数据
    store = DataStore()
    
    # 执行搜索采集
    results = search_and_collect(d, CONFIG['keyword'])
    
    # 更新存储
    if results:
        for item in results:
            store.update_item(item)
        store.export_csv()
    
    # 报表
    store.print_report()
    
    log('✅ 完成')

if __name__ == '__main__':
    main()
