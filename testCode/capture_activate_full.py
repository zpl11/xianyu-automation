"""
捕获 activate API 的完整响应以分析结构
"""
import json, time, sys
from playwright.sync_api import sync_playwright

results = {}

def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}')
    sys.stdout.flush()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    def on_response(response):
        url = response.url
        if 'h5api.m.goofish.com/h5/mtop.' not in url:
            return
        try:
            body = response.text()
        except:
            return
        
        import re
        m = re.match(r'^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$', body, re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(1))
                api = parsed.get('api', '')
                if api and api not in results:
                    results[api] = parsed
                    log(f'捕获: {api}')
            except:
                pass
    
    page.on('response', on_response)
    
    log('访问搜索页...')
    page.goto('https://www.goofish.com/search?q=手机', wait_until='networkidle', timeout=30000)
    time.sleep(5)
    
    log(f'\n捕获到 {len(results)} 个API响应:\n')
    
    for api_name, data in sorted(results.items()):
        ret = data.get('ret', [''])[0]
        api_data = data.get('data', {})
        keys = list(api_data.keys()) if isinstance(api_data, dict) else []
        
        print(f'\n=== {api_name} ===')
        print(f'  ret: {ret}')
        print(f'  data keys: {keys}')
        
        # 检查关键字段
        if isinstance(api_data, dict):
            for key in keys:
                val = api_data[key]
                if isinstance(val, list):
                    print(f'    {key}: list[{len(val)}]')
                    if len(val) > 0:
                        first = val[0]
                        if isinstance(first, dict):
                            print(f'      [0] keys: {list(first.keys())[:10]}')
                            # 检查是否有itemId
                            for k in first:
                                if 'id' in k.lower() or 'item' in k.lower() or 'title' in k.lower():
                                    print(f'      [{k}]: {str(first[k])[:50]}')
                elif isinstance(val, dict):
                    print(f'    {key}: dict{{{len(val)} keys}}')
                    if 'itemId' in val or 'title' in val:
                        print(f'      itemId={val.get("itemId","")} title={str(val.get("title",""))[:30]}')
                else:
                    sval = str(val)
                    if len(sval) < 100:
                        print(f'    {key}: {sval}')
    
    browser.close()
