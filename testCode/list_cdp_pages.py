"""
列出 Chrome CDP 中所有闲鱼相关页面
"""
import json, urllib.request

pages = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json").read())
print(f"总页面数: {len(pages)}\n")

for p in pages:
    url = p.get("url", "")
    title = p.get("title", "")
    if "goofish" in url or "闲鱼" in title or "xianyu" in url or "idlefish" in url:
        print(f"ID:    {p['id']}")
        print(f"Title: {title}")
        print(f"URL:   {url[:150]}")
        print(f"WS:    {p.get('webSocketDebuggerUrl', '')[:80]}")
        print()
