"""
调试 API 响应捕获
"""
from playwright.sync_api import sync_playwright
import time, re, json

results = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    def on_response(response):
        url = response.url
        if 'h5api.m.goofish.com/h5/mtop.' in url:
            results.append(url)
            print(f'  [RSP] {url[:120]}')
    
    page.on('response', on_response)
    
    page.goto('https://www.goofish.com/', wait_until='domcontentloaded', timeout=30000)
    print("等待5秒加载API...")
    time.sleep(5)
    
    print(f'\n首页API请求: {len(results)}')
    for r in results[:10]:
        print(f'  {r[:120]}')
    
    # 搜索
    results.clear()
    print('\n导航到搜索页...')
    page.goto('https://www.goofish.com/search?q=手机', wait_until='domcontentloaded', timeout=30000)
    time.sleep(8)
    
    print(f'搜索API请求: {len(results)}')
    for r in results[:15]:
        print(f'  {r[:120]}')
    
    browser.close()
