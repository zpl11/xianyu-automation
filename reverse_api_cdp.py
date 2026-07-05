"""
闲鱼 API 逆向分析 - 通过 CDP 连接到运行中的 Chrome
===================================================
利用用户已登录的 Chrome 会话，访问闲鱼页面并捕获完整 API 响应。
"""
import json, re, time, sys
from playwright.sync_api import sync_playwright

CDP_URL = 'http://127.0.0.1:9222'

def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}')
    sys.stdout.flush()


def format_dict_structure(d, indent=0, max_depth=4, show_short_values=True):
    """格式化显示字典结构"""
    prefix = '  ' * indent
    if not isinstance(d, dict):
        val = str(d)
        if len(val) > 100:
            val = val[:100] + '...'
        return f'{prefix}{val}'
    
    lines = []
    for k, v in sorted(d.items()):
        if isinstance(v, dict):
            if indent < max_depth:
                sub = format_dict_structure(v, indent+1, max_depth, show_short_values)
                lines.append(f'{prefix}{k}: {{{{{len(v)} keys}}}}')
                for line in sub.split('\n'):
                    lines.append(line)
            else:
                lines.append(f'{prefix}{k}: {{{{{len(v)} keys}}}}')
        elif isinstance(v, list):
            if len(v) == 0:
                lines.append(f'{prefix}{k}: []')
            elif indent < max_depth and len(v) > 0:
                first = v[0]
                if isinstance(first, dict):
                    lines.append(f'{prefix}{k}: [{len(v)} items]')
                    if indent + 1 < max_depth:
                        for sk in list(first.keys())[:10]:
                            sv = first[sk]
                            if isinstance(sv, (str, int, float, bool)):
                                s = str(sv)[:60]
                                lines.append(f'{prefix}  [{0}].{sk}: {s}')
                            elif isinstance(sv, dict):
                                lines.append(f'{prefix}  [{0}].{sk}: {{{len(sv)} keys}}')
                            elif isinstance(sv, list):
                                lines.append(f'{prefix}  [{0}].{sk}: [{len(sv)} items]')
                elif isinstance(first, (str, int, float)):
                    lines.append(f'{prefix}{k}: [{len(v)}] = {first}')
        elif isinstance(v, (str, int, float, bool)):
            val = str(v)
            if len(val) > 100:
                val = val[:100] + '...'
            lines.append(f'{prefix}{k}: {val}')
        elif v is None:
            lines.append(f'{prefix}{k}: null')
    return '\n'.join(lines)


class APICapture:
    def __init__(self):
        self.results = {}  # api_name -> parsed_response
    
    def on_response(self, response):
        url = response.url
        if 'h5api.m.goofish.com/h5/mtop.' not in url:
            # Also capture detail page HTML
            if 'www.goofish.com/item/' in url or 'www.goofish.com/shop/' in url:
                pass  # We track navigations separately
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
                ret = parsed.get('ret', [''])[0]
                if api:
                    self.results[api] = {
                        'data': parsed,
                        'ret': ret,
                        'url': url,
                        'time': time.time(),
                    }
                    log(f'  📥 {api:55s} {ret[:50]}')
            except:
                pass


def main():
    print('=' * 60)
    print('  闲鱼 API 逆向分析 (CDP 模式)')
    print('  连接到运行中的 Chrome...')
    print('=' * 60)
    
    cap = APICapture()
    
    with sync_playwright() as p:
        # 连接到已有 Chrome (CDP)
        browser = p.chromium.connect_over_cdp(CDP_URL)
        log(f'✅ 已连接到 Chrome (版本: 149)')
        
        # 获取已有页面或创建新页
        if browser.contexts:
            context = browser.contexts[0]
        else:
            context = browser.new_context()
        
        if context.pages:
            page = context.pages[0]
        else:
            page = context.new_page()
        
        log(f'📄 当前页面: {page.url[:80]}')
        
        # 设置响应监听
        page.on('response', cap.on_response)
        
        # ===== Step 1: 访问商品详情页 =====
        print('\n\n📌 Step 1: 访问商品详情页')
        print('=' * 60)
        
        # 使用已知商品ID
        item_id = '1059354152213'
        detail_url = f'https://www.goofish.com/item/{item_id}'
        log(f'🌐 导航到: {detail_url}')
        
        try:
            page.goto(detail_url, wait_until='networkidle', timeout=30000)
        except:
            log('⏱️ 页面加载超时，等待额外5秒...')
            time.sleep(5)
        
        time.sleep(3)  # 额外等待API响应
        
        # ===== Step 2: 分析 detail API =====
        print('\n\n📌 Step 2: 分析 Detail API 结构')
        print('=' * 60)
        
        detail_api = None
        for api_name in cap.results:
            if 'pc.detail' in api_name:
                detail_api = cap.results[api_name]
                break
        
        if detail_api:
            data = detail_api['data']
            api_data = data.get('data', {})
            log(f'✅ 捕获到 detail API')
            print(f'\n完整响应结构:\n')
            print(format_dict_structure(data, show_short_values=True))
            
            print(f'\n\n--- itemDO (5维数据) ---')
            item = api_data.get('itemDO', {})
            if item:
                for k in ['itemId', 'title', 'soldPrice', 'browseCnt', 'wantCnt', 'collectCnt', 'interactFavorCnt', 'evaluateCnt']:
                    if k in item:
                        print(f'  {k:25s} = {item[k]}')
            
            print(f'\n\n--- sellerDO ---')
            seller = api_data.get('sellerDO', {})
            if seller:
                seller_id = seller.get('sellerId', '')
                nick = seller.get('nick', '')
                print(f'  sellerId: {seller_id}')
                print(f'  nick: {nick}')
                
                # sellerItems
                seller_items = seller.get('sellerItems', [])
                if seller_items and isinstance(seller_items, list):
                    print(f'\n  sellerItems: [{len(seller_items)} items]')
                    for i, si in enumerate(seller_items[:10]):
                        print(f'    [{i}] itemId={si.get("itemId","?")} '
                              f'title={str(si.get("title",""))[:40]} '
                              f'price={si.get("price","")}')
                
                # ===== Step 3: 访问店铺页 =====
                if seller_id:
                    print(f'\n\n📌 Step 3: 访问店铺页 (sellerId={seller_id})')
                    print('=' * 60)
                    
                    shop_url = f'https://www.goofish.com/shop/{seller_id}'
                    log(f'🌐 导航到: {shop_url}')
                    
                    try:
                        page.goto(shop_url, wait_until='networkidle', timeout=30000)
                    except:
                        time.sleep(5)
                    
                    time.sleep(5)
                    
                    print(f'\n--- 店铺页API ({len(cap.results)} total) ---')
                    for api_name, info in sorted(cap.results.items()):
                        api_data2 = info['data'].get('data', {})
                        if isinstance(api_data2, dict):
                            keys2 = list(api_data2.keys())[:10]
                        else:
                            keys2 = []
                        print(f'\n{api_name}')
                        print(f'  ret: {info["ret"][:60]}')
                        print(f'  keys: {keys2}')
                        
                        # 查找包含商品列表的字段
                        if isinstance(api_data2, dict):
                            for k, v in api_data2.items():
                                if isinstance(v, list) and len(v) > 0:
                                    first = v[0]
                                    if isinstance(first, dict):
                                        has_item = any(x in str(first) for x in ['itemId', 'item_id', 'title'])
                                        if has_item:
                                            print(f'  📦 {k}: [{len(v)} items] ← 包含商品数据!')
                                            for i, si in enumerate(v[:5]):
                                                iid = si.get('itemId', si.get('id', si.get('item_id', '?')))
                                                ttl = str(si.get('title', ''))[:50]
                                                print(f'    [{i}] id={iid} title={ttl}')
        else:
            log('❌ 未捕获到 detail API')
            print('\n捕获到的所有API:')
            for api_name, info in sorted(cap.results.items()):
                print(f'  {api_name:55s} {info["ret"][:50]}')
        
        browser.close()
    
    print('\n' + '=' * 60)
    print('  逆向分析完成')
    print('=' * 60)


if __name__ == '__main__':
    main()
