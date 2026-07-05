"""
检查 activate API 的响应结构
"""
import json

# Re-run the playwright capture but save full response body
# Instead, let's look at the URL patterns
print("请运行以下命令捕获 activate API 的完整响应:")
print()
print("python -c \"")
print("import asyncio")
print("from playwright.async_api import async_playwright")
print("")
print("async def main():")
print("    async with async_playwright() as p:")
print("        browser = await p.chromium.launch(headless=True)")
print("        page = await browser.new_page()")
print("        results = []")
print("        ")
print("        async def on_response(response):")
print("            url = response.url")
print("            if 'activate' in url and 'h5api.m.goofish.com' in url:")
print("                body = await response.text()")
print("                results.append(body[:2000])")
print("        ")
print("        page.on('response', on_response)")
print("        await page.goto('https://www.goofish.com/search?q=test',")
print("                        wait_until='networkidle')")
print("        await asyncio.sleep(5)")
print("        ")
print("        if results:")
print("            for r in results:")
print("                print(r)")
print("        await browser.close()")
print("")
print("asyncio.run(main())")
print("\"")
print()
print("或者使用 --no-headless 模式查看浏览器中的实际响应。")
