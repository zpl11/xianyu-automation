"""
打开平板闲鱼App浏览商品，通过 mitmdump 记录所有API请求URL
不需要安装证书，mitmdump 以隧道模式运行
"""
import uiautomator2 as u2
import time
import subprocess
import re

d = u2.connect("192.168.1.58")
ITEM = "1008750028209"

print("1. 打开闲鱼App...")
d.app_start("com.taobao.idlefish")
time.sleep(3)

# 清空旧的mitm日志
open("mitm_tunnel.log", "w").close()

print(f"2. 打开商品详情: {ITEM}...")
d.shell(["am", "start", "-a", "android.intent.action.VIEW",
         "-d", f"goofish://item/{ITEM}",
         "-p", "com.taobao.idlefish"])
time.sleep(8)

print("3. 读取mitmdump日志中的闲鱼API请求...")
with open("mitm_tunnel.log", encoding="utf-8", errors="replace") as f:
    log = f.read()

# 提取所有包含 goofish 或 taobao 的URL
urls = re.findall(r'(https?://[^\s"\']*(?:goofish|taobao|mtop)[^\s"\']*)', log)
# 也提取 CONNECT 请求中的域名
connects = re.findall(r'CONNECT\s+([^\s:]+)', log)

apis = set()
for u in urls:
    m = re.search(r'(mtop\.[^/?]+)', u)
    if m:
        apis.add(m.group(1))

print(f"\n  发现的API ({len(apis)}):")
for a in sorted(apis):
    print(f"    {a}")

print(f"\n  连接的域名 ({len(connects)}):")
for c in sorted(set(connects)):
    if any(x in c for x in ["goofish", "taobao", "mtop", "idlefish"]):
        print(f"    {c}")

# 也检查是否有comment相关的请求
comment_urls = [u for u in urls if any(x in u.lower() for x in ["comment", "interact", "msg", "reply"])]
if comment_urls:
    print(f"\n  留言相关请求 ({len(comment_urls)}):")
    for u in comment_urls[:10]:
        print(f"    {u[:120]}")
else:
    print("\n  未发现留言相关的API请求")

# 显示日志中与闲鱼相关的行
print("\n=== 相关日志 ===")
for line in log.split("\n"):
    if any(x in line.lower() for x in ["goofish", "taobao", "mtop", "idlefish", "comment", "interact"]):
        if len(line) > 5:
            print(f"  {line[:200]}")
