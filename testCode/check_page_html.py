"""
查看页面 HTML 内容
"""
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('https://www.goofish.com/', timeout=30000)
    time.sleep(3)
    
    html = page.content()
    print(f"页面大小: {len(html)} bytes\n")
    
    # Show the first 3000 chars
    print("=== 前3000字符 ===")
    print(html[:3000])
    print("\n...")
    
    # Show script tags
    import re
    scripts = re.findall(r'<script[^>]*src="([^"]*)"', html)
    print(f"\n=== Scripts ({len(scripts)}) ===")
    for s in scripts:
        print(f"  {s[:120]}")
    
    browser.close()
