"""
极简调试 - 捕获所有请求和响应
"""
from playwright.sync_api import sync_playwright
import time

reqs = []
resps = []

with sync_playwright() as p:
    print("启动浏览器...")
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    page.on('request', lambda req: reqs.append(req.url) if 'goofish' in req.url else None)
    page.on('response', lambda resp: resps.append(resp.url) if 'goofish' in resp.url else None)
    
    print("导航...")
    page.goto('https://www.goofish.com/', timeout=30000)
    
    print(f"等待后, 请求数: {len(reqs)}, 响应数: {len(resps)}")
    time.sleep(10)
    print(f"10秒后, 请求数: {len(reqs)}, 响应数: {len(resps)}")
    
    for r in reqs:
        if 'h5api' in r:
            print(f"  API REQ: {r[:120]}")
    for r in resps:
        if 'h5api' in r:
            print(f"  API RSP: {r[:120]}")
    
    if not any('h5api' in r for r in reqs):
        print("\n没有API请求! 尝试检查页面内容...")
        print(f"页面URL: {page.url}")
        print(f"页面标题: {page.title()}")
        html = page.content()
        print(f"页面大小: {len(html)} bytes")
        # Look for script tags that might load APIs
        if 'mtop' in html:
            print("页面包含 mtop 引用")
    
    browser.close()
