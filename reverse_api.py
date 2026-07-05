"""
闲鱼 API 逆向分析工具
========================
1. 访问商品详情页，捕获完整 API 响应
2. 解析 itemDO / sellerDO / sellerItems 结构
3. 访问店铺页，捕获店铺 API 响应
4. 输出完整的 API 数据结构，用于构建监控系统
"""
import json, re, time, sys
from playwright.sync_api import sync_playwright
from collections import OrderedDict


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}')
    sys.stdout.flush()


def format_value(v, indent=0):
    """格式化显示一个值"""
    prefix = '  ' * indent
    if isinstance(v, str):
        if len(v) > 80:
            return f'"{v[:80]}..."'
        return f'"{v}"'
    elif isinstance(v, (int, float, bool)):
        return str(v)
    elif v is None:
        return 'null'
    elif isinstance(v, list):
        if len(v) == 0:
            return '[]'
        return f'[{len(v)} items]'
    elif isinstance(v, dict):
        return f'{{{len(v)} keys}}'
    return str(type(v).__name__)


def analyze_dict(d, name="root", indent=0, max_depth=3, show_values=False):
    """递归分析字典结构"""
    if not isinstance(d, dict):
        print(f'{"  " * indent}{name}: {format_value(d)}')
        return
    if indent > max_depth:
        print(f'{"  " * indent}{name}: ... (max depth)')
        return
    
    print(f'{"  " * indent}{name}: ({len(d)} keys)')
    for k, v in sorted(d.items()):
        full_name = f'{name}.{k}' if name != 'root' else k
        if isinstance(v, dict):
            if show_values and all(isinstance(x, (str, int, float, bool)) for x in v.values()):
                print(f'{"  " * (indent+1)}{k}: {json.dumps(v, ensure_ascii=False)[:200]}')
            else:
                analyze_dict(v, k, indent+1, max_depth, show_values)
        elif isinstance(v, list):
            if len(v) == 0:
                print(f'{"  " * (indent+1)}{k}: []')
            else:
                print(f'{"  " * (indent+1)}{k}: [{len(v)} items]')
                if indent < max_depth and len(v) > 0:
                    first = v[0]
                    if isinstance(first, dict):
                        if show_values:
                            print(f'{"  " * (indent+2)}[0]: {json.dumps(first, ensure_ascii=False)[:300]}')
                        else:
                            print(f'{"  " * (indent+2)}[0] keys ({len(first)}): {list(first.keys())[:20]}')
                            for sk, sv in sorted(first.items()):
                                if isinstance(sv, (str, int, float, bool)):
                                    s = str(sv)
                                    if len(s) < 100:
                                        print(f'{"  " * (indent+3)}{sk}: {s}')
                                    else:
                                        print(f'{"  " * (indent+3)}{sk}: "{s[:50]}..."')
                                elif isinstance(sv, list):
                                    print(f'{"  " * (indent+3)}{sk}: [{len(sv)} items]')
                                elif isinstance(sv, dict):
                                    print(f'{"  " * (indent+3)}{sk}: {{{len(sv)} keys}}')
                    elif isinstance(first, (str, int, float)):
                        print(f'{"  " * (indent+2)}[0]: {first}')
        else:
            s = str(v)
            if len(s) < 100:
                print(f'{"  " * (indent+1)}{k}: {s}')
            else:
                print(f'{"  " * (indent+1)}{k}: "{s[:80]}..."')


def capture_item_detail(page, item_id, results):
    """捕获商品详情API的完整响应"""
    url = f'https://www.goofish.com/item/{item_id}'
    log(f'📄 访问商品详情: {item_id}')
    
    page.goto(url, wait_until='networkidle', timeout=30000)
    time.sleep(3)
    
    # 从之前捕获的结果中提取
    api_name = 'mtop.taobao.idle.pc.detail'
    if api_name in results:
        data = results[api_name]
        log(f'✅ 捕获到 detail API')
        return data
    
    # 也可能是其他路径
    for api, data in results.items():
        if 'detail' in api.lower() or 'item' in api.lower():
            if 'itemDO' in str(data.get('data', {})) or 'sellerDO' in str(data.get('data', {})):
                log(f'✅ 捕获到: {api}')
                return data
    
    log(f'⚠️ 未捕获到 detail API')
    return None


def capture_shop_page(page, seller_id, results):
    """访问店铺页并捕获API"""
    url = f'https://www.goofish.com/shop/{seller_id}'
    log(f'🏪 访问店铺: {seller_id}')
    
    page.goto(url, wait_until='networkidle', timeout=30000)
    time.sleep(5)
    
    # 找出所有店铺相关的API
    shop_apis = {}
    for api, data in results.items():
        if 'shop' in api.lower() or 'seller' in api.lower() or 'user' in api.lower() or 'item' in api.lower():
            shop_apis[api] = data
    
    if shop_apis:
        log(f'✅ 捕获到 {len(shop_apis)} 个店铺相关API')
    else:
        log(f'⚠️ 未捕获到店铺相关API')
    
    return shop_apis


def main():
    print('=' * 60)
    print('  闲鱼 API 逆向分析工具')
    print('=' * 60)
    
    # 已知商品ID（从已有导出数据中获取）
    item_ids = [
        '1059354152213',
        '1059012442631',
        '1057693582577',
    ]
    
    all_results = {}
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        results = {}
        
        def on_response(response):
            url = response.url
            if 'h5api.m.goofish.com/h5/mtop.' not in url:
                return
            try:
                body = response.text()
            except:
                return
            m = re.match(r'^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$', body, re.DOTALL)
            if m:
                try:
                    parsed = json.loads(m.group(1))
                    api = parsed.get('api', '')
                    if api:
                        if api not in results:
                            results[api] = parsed
                            log(f'  [API] {api}')
                        # 对于detail API，始终用最新响应
                        if 'detail' in api or 'item' in api:
                            results[api] = parsed
                except:
                    pass
        
        page.on('response', on_response)
        
        # Step 1: 访问商品详情页
        print('\n📌 Step 1: 访问商品详情页')
        print('-' * 40)
        
        for item_id in item_ids:
            capture_item_detail(page, item_id, results)
        
        # Step 2: 分析 detail API 结构
        print('\n\n📌 Step 2: 分析 detail API 结构')
        print('=' * 60)
        
        for api_name in list(results.keys()):
            if 'detail' in api_name.lower():
                data = results[api_name]
                ret = data.get('ret', [''])[0]
                print(f'\nAPI: {api_name}')
                print(f'ret: {ret}')
                
                api_data = data.get('data', {})
                if isinstance(api_data, dict):
                    # 详细分析 itemDO
                    item = api_data.get('itemDO', {})
                    if item:
                        print(f'\n--- itemDO ({len(item)} fields) ---')
                        # 5维数据字段
                        dim5_keys = ['browseCnt', 'wantCnt', 'collectCnt', 'interactFavorCnt', 'evaluateCnt']
                        for k in dim5_keys:
                            if k in item:
                                print(f'  ✅ {k:25s} = {item[k]}')
                            else:
                                print(f'  ❌ {k:25s} = (not found)')
                        
                        # 所有字段值
                        print(f'\n--- itemDO 全部字段 ---')
                        for k, v in sorted(item.items()):
                            if isinstance(v, (str, int, float, bool)):
                                print(f'  {k:30s} = {v}')
                            elif isinstance(v, list):
                                print(f'  {k:30s} = [{len(v)} items]')
                            elif isinstance(v, dict):
                                print(f'  {k:30s} = {{{len(v)} keys}}')
                    
                    # sellerDO
                    seller = api_data.get('sellerDO', {})
                    if seller:
                        print(f'\n--- sellerDO ({len(seller)} fields) ---')
                        for k, v in sorted(seller.items()):
                            if isinstance(v, (str, int, float, bool)):
                                print(f'  {k:30s} = {v}')
                            elif isinstance(v, list):
                                print(f'  {k:30s} = [{len(v)} items]')
                                if 'sellerItems' in k or 'items' in k:
                                    for i, si in enumerate(v[:5]):
                                        if isinstance(si, dict):
                                            print(f'    [{i}]: itemId={si.get("itemId","?")}, title={str(si.get("title",""))[:30]}')
                            elif isinstance(v, dict):
                                print(f'  {k:30s} = {{{len(v)} keys}}')
                    
                    # 其他顶层字段
                    others = [k for k in api_data if k not in ('itemDO', 'sellerDO')]
                    if others:
                        print(f'\n--- 其他 data 字段 ({len(others)}) ---')
                        for k in others:
                            v = api_data[k]
                            if isinstance(v, (str, int, float, bool)):
                                print(f'  {k:30s} = {v}')
                            elif isinstance(v, list):
                                print(f'  {k:30s} = [{len(v)} items]')
                            elif isinstance(v, dict):
                                print(f'  {k:30s} = {{{len(v)} keys}}')
                
                # 保存 sellerId 用于下一步
                if seller:
                    sid = seller.get('sellerId', '')
                    if sid:
                        print(f'\n🎯 卖家ID: {sid} (nick: {seller.get("nick", "?")})')
                        # Step 3: 访问店铺页
                        print(f'\n\n📌 Step 3: 访问店铺页 (sellerId={sid})')
                        print('=' * 60)
                        
                        shop_results = {}
                        
                        def shop_on_response(response):
                            url = response.url
                            if 'h5api.m.goofish.com/h5/mtop.' not in url:
                                return
                            try:
                                body = response.text()
                            except:
                                return
                            m = re.match(r'^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$', body, re.DOTALL)
                            if m:
                                try:
                                    parsed = json.loads(m.group(1))
                                    api = parsed.get('api', '')
                                    if api:
                                        shop_results[api] = parsed
                                        log(f'  [SHOP API] {api}')
                                except:
                                    pass
                        
                        page.on('response', shop_on_response)
                        
                        shop_url = f'https://www.goofish.com/shop/{sid}'
                        log(f'🏪 访问: {shop_url}')
                        page.goto(shop_url, wait_until='networkidle', timeout=30000)
                        time.sleep(5)
                        
                        print(f'\n--- 店铺页 API ({len(shop_results)}个) ---')
                        for api_name2, data2 in sorted(shop_results.items()):
                            ret2 = data2.get('ret', [''])[0][:60]
                            api_data2 = data2.get('data', {})
                            if isinstance(api_data2, dict):
                                keys2 = list(api_data2.keys())[:15]
                            else:
                                keys2 = []
                            print(f'  {api_name2:60s} ret={ret2}')
                            print(f'    data keys: {keys2}')
                            
                            # 分析有可能包含商品列表的字段
                            if isinstance(api_data2, dict):
                                for k, v in api_data2.items():
                                    if isinstance(v, list) and len(v) > 0:
                                        first = v[0]
                                        if isinstance(first, dict):
                                            if 'itemId' in first or 'id' in first or 'title' in first:
                                                print(f'    📦 {k}: [{len(v)} items] (contains item data!)')
                                                for i, si in enumerate(v[:5]):
                                                    item_id = si.get('itemId', si.get('id', '?'))
                                                    title = str(si.get('title', ''))[:40]
                                                    print(f'      [{i}]: itemId={item_id}, title={title}')
                
                break  # 只分析第一个成功的detail API
        
        # 如果没有捕获到 detail API，显示所有捕获的API
        if not any('detail' in a.lower() for a in results):
            print('\n\n未捕获到 detail API，显示所有捕获的API:')
            for api_name, data in sorted(results.items()):
                ret = data.get('ret', [''])[0][:60]
                api_data = data.get('data', {})
                if isinstance(api_data, dict):
                    print(f'  {api_name:60s} ret={ret} keys={list(api_data.keys())[:10]}')
                else:
                    print(f'  {api_name:60s} ret={ret}')
        
        browser.close()
    
    print('\n' + '=' * 60)
    print('  逆向分析完成')
    print('=' * 60)


if __name__ == '__main__':
    main()
