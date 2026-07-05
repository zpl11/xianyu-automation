"""
1. 设置平板代理 → 重启WiFi → 等待重连
2. 打开闲鱼App → 导航到商品详情
3. mitmproxy 捕获 API 流量
4. 分析捕获到的 API 找到留言数
"""
import uiautomator2 as u2
import time
import json
import os
import glob
import re
import sys

PROXY_IP = "192.168.1.102"
PROXY_PORT = 8890
ITEM_ID = "1008750028209"

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")
    sys.stdout.flush()

log("=== 平板流量强制捕获 ===")

# 1. 设置代理
log("1. 设置代理...")
d = u2.connect("192.168.1.58")
d.shell(["settings", "put", "global", "http_proxy", f"{PROXY_IP}:{PROXY_PORT}"])
r = d.shell(["settings", "get", "global", "http_proxy"])
log(f"   代理: {r.output.strip()}")

# 2. 重启WiFi（让代理生效）
log("2. 重启WiFi...")
d.shell(["svc", "wifi", "disable"])
time.sleep(2)

# WiFi关闭后ADB会断连，等待重连
log("   等待WiFi开启...")
try:
    d2 = u2.connect("192.168.1.58")
    d2.shell(["svc", "wifi", "enable"])
    log("   WiFi开启命令已发送")
except:
    time.sleep(3)
    d2 = u2.connect("192.168.1.58")
    d2.shell(["svc", "wifi", "enable"])

# 3. 等待平板重连
log("3. 等待平板重连（最多30秒）...")
device = None
for i in range(30):
    try:
        device = u2.connect("192.168.1.58")
        info = device.info
        log(f"   重连成功! {info.get('productName', '?')}")
        break
    except:
        time.sleep(1)
else:
    log("❌ 重连失败")
    sys.exit(1)

time.sleep(3)

# 4. 验证代理
r = device.shell(["settings", "get", "global", "http_proxy"])
log(f"4. 当前代理: {r.output.strip()}")

# 5. 打开商品详情
log("5. 打开闲鱼App...")
device.app_start("com.taobao.idlefish")
time.sleep(3)

log(f"   打开商品详情: {ITEM_ID}")
device.shell(["am", "start", "-a", "android.intent.action.VIEW",
              "-d", f"goofish://item/{ITEM_ID}",
              "-p", "com.taobao.idlefish"])
time.sleep(8)

# 6. 读取界面统计数字
log("6. 读取界面统计数据...")
xml = device.dump_hierarchy()
for kw, name in [("浏览","views"),("想要","wants"),("收藏","favs"),("留言","comments"),("评价","reviews")]:
    idx = xml.find(kw)
    if idx >= 0:
        chunk = xml[max(0,idx-50):idx+50]
        nums = re.findall(r'(\d+)', chunk)
        if nums:
            log(f"   {name}: {nums[-1]}")
        else:
            log(f"   {name}: 在 '{kw}' 附近未找到数字")
    else:
        log(f"   {name}: 未找到 '{kw}' 文本")

# 7. 检查 mitmproxy 捕获文件
log("\n7. 检查 mitmproxy 捕获...")
files = sorted(glob.glob("captured_apis_*.jsonl"), key=os.path.getctime)
if files:
    latest = files[-1]
    with open(latest, encoding='utf-8') as f:
        lines = f.readlines()
    apis = {}
    for line in lines:
        try:
            d = json.loads(line)
            api = d.get('api_name', '')
            if api:
                apis[api] = apis.get(api, 0) + 1
        except:
            pass
    if apis:
        log(f"   捕获到 {len(apis)} 个API:")
        for api, count in sorted(apis.items(), key=lambda x: -x[1])[:15]:
            log(f"     {api} x{count}")
    else:
        log(f"   文件有 {len(lines)} 行，但无API（可能只是请求记录）")
else:
    log("   未找到捕获文件")

# 清理：清除代理设置
log("\n8. 清除代理...")
device.shell(["settings", "put", "global", "http_proxy", ":0"])
log("✅ 完成")
