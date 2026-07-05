"""
在平板上打开闲鱼App浏览商品，同时通过mitmproxy捕获API
"""
import uiautomator2 as u2
import time
import glob
import json

d = u2.connect("192.168.1.58")

# 记录操作前捕获文件数
before = len(glob.glob("captured_apis_*.jsonl"))
print(f"操作前捕获文件数: {before}")

# 打开闲鱼App
print("1. 打开闲鱼App...")
d.app_start("com.taobao.idlefish")
time.sleep(3)

# 打开商品详情页
print("2. 打开商品详情...")
d.shell(["am", "start", "-a", "android.intent.action.VIEW",
         "-d", "goofish://item/1008750028209",
         "-p", "com.taobao.idlefish"])
time.sleep(10)

# 检查新捕获文件
after = len(glob.glob("captured_apis_*.jsonl"))
print(f"\n操作后捕获文件数: {after}")
if after > before:
    files = sorted(glob.glob("captured_apis_*.jsonl"))
    latest = files[-1]
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
        print(f"捕获到 {len(apis)} 个API:")
        for a in sorted(apis):
            print(f"  {a}")
    else:
        print(f"文件有 {len(lines)} 行，无API数据")
else:
    print("无新捕获文件，App流量未经过代理")
    print("尝试检查: 代理设置是否正确？证书是否已安装？")
