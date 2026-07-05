"""
快速 API 捕获 - 分析 activate API 结构
"""
import json, re, time
from playwright.sync_api import sync_playwright

results = {}

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
        m = re.match(r'^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$', body, re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(1))
                api = parsed.get('api', '')
                if api:
                    results[api] = parsed
                    print(f'  [OK] {api}')
            except:
                pass
    
    page.on('response', on_response)
    
    print('访问搜索页...')
    page.goto('https://www.goofish.com/search?q=手机', wait_until='networkidle', timeout=30000)
    time.sleep(5)
    
    print(f'\n捕获到 {len(results)} 个API:\n')
    
    for api_name, data in sorted(results.items()):
        ret = data.get('ret', [''])[0][:60]
        api_data = data.get('data', {})
        if isinstance(api_data, dict):
            keys = list(api_data.keys())
        else:
            keys = []
        
        print(f'=== {api_name} ===')
        print(f'  ret: {ret}')
        print(f'  keys: {keys}')
        
        # 详细检查 activate API
        if 'activate' in api_name:
            for key in keys:
                val = api_data[key]
                if isinstance(val, list):
                    print(f'  {key}: list[{len(val)}]')
                    if val:
                        first = val[0]
                        if isinstance(first, dict):
                            print(f'    [0].keys = {list(first.keys())[:15]}')
                            # Search for item identifiers
                            for k in first:
                                v = first[k]
                                if isinstance(v, (str, int)) and ('id' in k.lower() or 'item' in k.lower()):
                                    print(f'    [{k}] = {v}')
                                if isinstance(v, dict):
                                    subkeys = list(v.keys())[:5]
                                    if subkeys:
                                        for sk in subkeys:
                                            sv = v[sk]
                                            if isinstance(sv, (str, int)):
                                                print(f'    [{k}][{sk}] = {sv}')
                elif isinstance(val, dict):
                    print(f'  {key}: dict')
                    for k, v in val.items():
                        if isinstance(v, (str, int)) and len(str(v)) < 100:
                            print(f'    [{k}] = {v}')
                else:
                    s = str(val)
                    if len(s) < 80:
                        print(f'  {key}: {s}')
    
    browser.close()
