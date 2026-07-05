"""
1. 设置平板代理到 mitmproxy
2. 重启 WiFi 强制代理生效
3. 打开闲鱼 App 并导航到商品详情
4. 尝试捕获 API 流量
"""
import uiautomator2 as u2
import time
import sys

PROXY_HOST = "192.168.1.102"
PROXY_PORT = 8890

d = u2.connect("192.168.1.58")

print("1. 设置代理...")
d.shell(["settings", "put", "global", "http_proxy", f"{PROXY_HOST}:{PROXY_PORT}"])
time.sleep(1)
r = d.shell(["settings", "get", "global", "http_proxy"])
print(f"   代理: {r.output.strip()}")

print("2. 重启 WiFi...")
d.shell(["svc", "wifi", "disable"])
time.sleep(3)
d.shell(["svc", "wifi", "enable"])
time.sleep(5)
# 检查IP
r = d.shell(["ip", "addr", "show", "wlan0"])
for line in r.output.split("\n"):
    if "inet " in line:
        print(f"   IP: {line.strip()}")
        break

print("3. 打开闲鱼 App...")
d.app_start("com.taobao.idlefish")
time.sleep(3)

print("4. 打开商品详情页...")
item_id = "1008750028209"  # 用户说有留言的商品
d.shell(["am", "start", "-a", "android.intent.action.VIEW",
         "-d", f"https://www.goofish.com/item/{item_id}"])
time.sleep(8)

print("5. 从界面读取统计数据...")
xml = d.dump_hierarchy()

import re
for keyword in ["浏览", "想要", "收藏", "留言", "评价"]:
    idx = xml.find(keyword)
    if idx >= 0:
        chunk = xml[max(0,idx-30):idx+30]
        nums = re.findall(r'(\d+)', chunk)
        print(f"   {keyword}: {nums[0] if nums else '?'} (附近: {chunk.strip()[:80]})")

print("\n6. 查看 mitmproxy 是否捕获到流量...")
import socket
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(3)
result = sock.connect_ex(("127.0.0.1", 8890))
print(f"   mitmproxy 端口 8890: {'开放' if result == 0 else '关闭'}")
sock.close()

import glob
files = glob.glob("captured_apis_*.jsonl")
if files:
    latest = max(files, key=os.path.getctime)
    print(f"   最新捕获文件: {latest}")
    with open(latest, encoding='utf-8') as f:
        lines = f.readlines()
    apis = set()
    for line in lines:
        try:
            d = json.loads(line)
            if d.get('api_name'):
                apis.add(d['api_name'])
        except: pass
    if apis:
        print(f"   捕获到 API: {', '.join(sorted(apis)[:10])}")
    else:
        print(f"   文件有 {len(lines)} 行，但没有解析出API")
else:
    print("   未找到捕获文件")

import os, json
