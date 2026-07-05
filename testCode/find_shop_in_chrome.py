"""
在Chrome中找到所有闲鱼页面和可能的店铺ID
"""
import json, urllib.request

pages = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json").read())

print("找到的闲鱼页面:\n")

for p in pages:
    url = p.get("url", "")
    title = p.get("title", "")
    if "goofish" not in url and "闲鱼" not in title and "xianyu" not in url:
        continue
    
    print(f"  标题: {title}")
    print(f"  URL:  {url[:150]}")
    
    # 从URL提取userId
    import re
    m = re.search(r"userId=(\d+)", url)
    if m:
        print(f"  ✅ 店铺ID: {m.group(1)}")
        print(f"  📋 监控命令: node shop_monitor_v2.mjs --userId={m.group(1)}")
    print()
