"""
通过 route 拦截捕获 API 响应
"""
import json, re, time
from playwright.sync_api import sync_playwright

results = {}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    def handle_route(route):
        url = route.request.url
        if 'h5api.m.goofish.com/h5/mtop.' in url:
            # 继续请求但捕获响应
            response = route.request.response()
            if response:
                try:
                    body = response.text()
                    m = re.match(r'^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$', body, re.DOTALL)
                    if m:
                        parsed = json.loads(m.group(1))
                        api = parsed.get('api', '')
                        if api:
                            results[api] = parsed
                except Exception as e:
                    pass
        route.continue_()
    
    # 使用 route 拦截所有请求
    # 实际上更好的方式是用 page.on('response')
    # 但可能是 Playwright 版本问题，改用另一种方式
    
    page.on('response', lambda resp: (
        # 不是lambda的理想用法，但用于调试
        None
    ))
    
    # 直接用page.evaluate注入拦截器
    page.goto('https://www.goofish.com/', wait_until='domcontentloaded')
    
    # 注入 fetch/XHR 拦截
    page.evaluate("""
    () => {
        const results = [];
        const origFetch = window.fetch;
        window.fetch = function(url, opts) {
            return origFetch.apply(this, arguments).then(resp => {
                if (typeof url === 'string' && url.includes('h5api.m.goofish.com')) {
                    resp.clone().text().then(text => {
                        window.__captured = window.__captured || [];
                        window.__captured.push({url, text: text.substring(0, 5000)});
                    });
                }
                return resp;
            });
        };
        window.__captured = [];
    }
    """)
    
    time.sleep(1)
    
    # 导航到搜索页
    print("搜索: 手机")
    page.goto('https://www.goofish.com/search?q=手机', wait_until='domcontentloaded')
    time.sleep(5)
    
    # 获取捕获的数据
    captured = page.evaluate("() => window.__captured || []")
    print(f"\n捕获到 {len(captured)} 个请求\n")
    
    for c in captured[:10]:
        url = c.get('url', '')[:120]
        text = c.get('text', '')
        api_name = ''
        if text:
            m = re.match(r'.*"api"\s*:\s*"([^"]+)".*', text)
            if m:
                api_name = m.group(1)
        print(f'  {api_name:55s} {url}')
    
    browser.close()
