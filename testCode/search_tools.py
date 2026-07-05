"""
搜索市面上已有的闲鱼监控工具
"""
import urllib.request
import urllib.parse
import re
import json

# 设置系统代理
proxy = urllib.request.ProxyHandler({
    'http': '127.0.0.1:10808',
    'https': '127.0.0.1:10808'
})
opener = urllib.request.build_opener(proxy)
urllib.request.install_opener(opener)

queries = [
    "闲鱼监控 上新提醒 价格监控",
    "闲鱼店铺监控 数据分析",
    "闲鱼商品监控 浏览量 想要数",
    "Xianyu monitor tool listing tracker",
    "闲鱼竞品分析 数据导出",
    "闲鱼数据采集 店铺监控软件",
]

seen = set()
for q in queries:
    print(f"\n=== 搜索: {q} ===")
    try:
        url = f"https://www.google.com/search?q={urllib.parse.quote(q)}&hl=zh-CN&num=10"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        resp = urllib.request.urlopen(req, timeout=8)
        html = resp.read().decode('utf-8', errors='replace')
        
        # 提取搜索结果标题和链接
        pattern = r'<a[^>]*href="/url\?q=([^&"]+)[^"]*"[^>]*><br>|<h3[^>]*>(.*?)</h3>'
        for m in re.finditer(r'<a[^>]*href="/url\?q=([^&"]+)"[^>]*>(.*?)</a>', html):
            url2 = urllib.parse.unquote(m.group(1))
            title = re.sub(r'<[^>]+>', '', m.group(2)).strip()
            if title and url2 not in seen and 'google' not in url2:
                seen.add(url2)
                print(f"  {title[:60]}")
                print(f"    {url2[:80]}")
    except Exception as e:
        print(f"  错误: {e}")
