"""
调试页面加载状态
"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('https://www.goofish.com/search?q=test', timeout=30000)
    
    print(f'Title: {page.title()}')
    print(f'URL: {page.url}')
    print(f'Content size: {len(page.content())} chars')
    
    # 检查网络请求
    requests = []
    def on_request(req):
        url = req.url
        if 'h5api.m.goofish.com' in url:
            requests.append(url)
            print(f'  [REQ] {url[:120]}')
    
    page.on('request', on_request)
    page.reload(wait_until='networkidle', timeout=30000)
    
    print(f'\n捕获到 {len(requests)} 个API请求')
    for r in requests[:10]:
        print(f'  {r[:120]}')
    
    browser.close()
