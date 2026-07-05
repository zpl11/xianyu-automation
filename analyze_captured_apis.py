"""
捕获数据分析工具
================
分析 mitmproxy 捕获的闲鱼 API 数据，统计已发现的 API 端点、5维数据、请求参数等。

用法:
  python analyze_captured_apis.py
  python analyze_captured_apis.py --file captured_apis_xxx.jsonl
  python analyze_captured_apis.py --watch   # 持续监控模式
"""

import json
import os
import sys
import glob
import re
from datetime import datetime
from collections import Counter, defaultdict

# ============================================================
#  配置
# ============================================================
# 关注的5维数据字段
DIM5_FIELDS = {
    'browseCnt': '浏览数',
    'wantCnt': '想要数',
    'collectCnt': '收藏数',
    'interactFavorCnt': '留言数',
    'evaluateCnt': '评价数',
}

# 感兴趣的API关键词
INTERESTING_KEYWORDS = [
    'detail', 'search', 'item', 'shop', 'store',
    'user', 'seller', 'collect', 'favor',
    'comment', 'evaluate', 'review', 'rate',
    'publish', 'list', 'home', 'feed',
    'browse', 'want', 'recycle',
    'circle', 'message', 'chat',
]


def log(msg):
    print(f'[{datetime.now().strftime("%H:%M:%S")}] {msg}')


def find_latest_file():
    """查找最新的捕获文件"""
    files = sorted(glob.glob('captured_apis_*.jsonl'), key=os.path.getctime)
    return files[-1] if files else None


def analyze_file(filepath):
    """分析捕获文件"""
    print(f'\n📊 分析文件: {filepath}')
    print(f'   文件大小: {os.path.getsize(filepath):,} bytes')
    
    records = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except:
                    pass
    
    print(f'   总记录数: {len(records)}')
    
    # 分类统计
    requests = [r for r in records if r.get('type') == 'request']
    responses = [r for r in records if r.get('type') == 'response']
    
    print(f'   请求数: {len(requests)}')
    print(f'   响应数: {len(responses)}')
    
    # 统计API
    apis = Counter()
    api_details = defaultdict(list)
    dim5_total = 0
    api_with_5dim = set()
    
    for r in responses:
        api_name = r.get('api_name', '') or '(unknown)'
        apis[api_name] += 1
        api_details[api_name].append(r)
        
        if r.get('5dim_data'):
            dim5 = r['5dim_data']
            has_data = any(v is not None for v in dim5.values())
            if has_data:
                dim5_total += 1
                api_with_5dim.add(api_name)
    
    print()
    print('=' * 60)
    print('  📋 发现的 API 端点')
    print('=' * 60)
    print(f'  {"API名称":55s} {"调用次数":>8s}')
    print(f'  {"-"*55} {"-"*8}')
    
    for api_name, count in apis.most_common():
        marker = ' ✅' if api_name in api_with_5dim else ''
        print(f'  {api_name[:55]:55s} {count:>8d}{marker}')
    
    print()
    print('=' * 60)
    print('  📊 5维数据提取情况')
    print('=' * 60)
    print(f'  含5维数据的响应: {dim5_total}')
    print(f'  涉及的API: {len(api_with_5dim)}')
    print()
    
    # 详细的5维数据
    if dim5_total > 0:
        print(f'  {"#":>3s} {"API名称":40s} {"浏览":>6s} {"想要":>6s} {"收藏":>6s} {"留言":>6s} {"评价":>6s}')
        print(f'  {"-"*3} {"-"*40} {"-"*6} {"-"*6} {"-"*6} {"-"*6} {"-"*6}')
        
        count = 0
        for r in responses:
            if r.get('5dim_data'):
                d5 = r['5dim_data']
                has_data = any(v is not None for v in d5.values())
                if has_data:
                    count += 1
                    api_short = r.get('api_name', '?')[:40]
                    b = d5.get('browseCnt', '') or '-'
                    w = d5.get('wantCnt', '') or '-'
                    c = d5.get('collectCnt', '') or '-'
                    i = d5.get('interactFavorCnt', '') or '-'
                    e = d5.get('evaluateCnt', '') or '-'
                    print(f'  {count:>3d} {api_short:40s} {str(b):>6s} {str(w):>6s} {str(c):>6s} {str(i):>6s} {str(e):>6s}')
                    
                    item_info = r.get('item_info', {})
                    if item_info.get('title'):
                        print(f'      📌 {item_info["title"][:50]}')
                        if item_info.get('price'):
                            print(f'      💰 ¥{item_info["price"]}')
    
    # 请求参数分析
    print()
    print('=' * 60)
    print('  🔍 请求体结构分析 (含POST请求的API)')
    print('=' * 60)
    
    for r in requests:
        if r['method'] == 'POST':
            url = r.get('url', '')
            path = r.get('path', '')
            path_short = path.split('?')[0][:50]
            print(f'\n  📤 POST {path_short}')
            print(f'     完整URL: {url[:80]}')
    
    # 返回统计摘要
    return {
        'total_records': len(records),
        'api_count': len(apis),
        'api_with_5dim': len(api_with_5dim),
        'dim5_items': dim5_total,
        'apis': dict(apis.most_common(30)),
    }


def main():
    # 检查参数
    if '--watch' in sys.argv:
        # 持续监控模式
        watched = set()
        log('📡 持续监控模式 (每5秒检查新文件)')
        while True:
            import time
            files = sorted(glob.glob('captured_apis_*.jsonl'), key=os.path.getctime)
            for f in files:
                if f not in watched:
                    print(f'\n{"="*60}')
                    analyze_file(f)
                    print(f'\n{"="*60}')
                    watched.add(f)
            time.sleep(5)
        return
    
    file_specified = None
    for arg in sys.argv[1:]:
        if arg.startswith('--file='):
            file_specified = arg.split('=', 1)[1]
    
    filepath = file_specified or find_latest_file()
    if not filepath:
        print('❌ 未找到捕获文件')
        print('   请先在平板上操作闲鱼App产生流量')
        print('   或使用 --file= 指定文件')
        return
    
    summary = analyze_file(filepath)
    
    print()
    print('=' * 60)
    print('  📋 分析摘要')
    print('=' * 60)
    print(f'  发现 {summary["api_count"]} 个API端点')
    print(f'  其中 {summary["api_with_5dim"]} 个含5维数据')
    print(f'  共提取 {summary["dim5_items"]} 次商品数据')
    print()
    
    # 提供建议
    if summary['dim5_items'] == 0:
        print('⚠️  暂未提取到5维数据。可能原因:')
        print('   1. 平板上未浏览商品详情页')
        print('   2. 未登录闲鱼账号')
        print('   3. 需要安装CA证书以解密HTTPS')
        print()
        print('💡 建议:')
        print('   1. 在平板上打开闲鱼App并登录')
        print('   2. 浏览几个商品详情页')
        print('   3. 搜索商品并浏览列表')
        print('   4. 查看某个店铺的商品列表')
    
    print()
    print(f'💡 继续捕获更多数据: 在平板上自由操作闲鱼App')
    print(f'💡 分析其他文件: python analyze_captured_apis.py --file=captured_apis_xxx.jsonl')
    print(f'💡 持续监控: python analyze_captured_apis.py --watch')


if __name__ == '__main__':
    main()
