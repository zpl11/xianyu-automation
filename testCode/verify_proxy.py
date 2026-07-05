"""
验证平板是否通过代理上网
"""
import uiautomator2 as u2
import time
import json
import glob

d = u2.connect("192.168.1.58")

# 1. 检查代理设置
r = d.shell(["settings", "get", "global", "http_proxy"])
print(f"代理设置: {r.output.strip()}")

# 2. 用平板浏览器访问一个网页来测试代理
print("\n通过平板浏览器测试代理...")
d.shell(["am", "start", "-a", "android.intent.action.VIEW",
         "-d", "http://example.com"])
time.sleep(5)

# 3. 检查mitmproxy是否有新捕获
time.sleep(2)
files = sorted(glob.glob("captured_apis_*.jsonl"), key=os.path.getctime)
if files:
    latest = files[-1]
    size = os.path.getsize(latest)
    print(f"\n最新捕获文件: {latest} ({size} bytes)")
    # 查看新增的行
    with open(latest, encoding='utf-8') as f:
        lines = f.readlines()
    print(f"行数: {len(lines)}")
    for line in lines[-3:]:
        try:
            d = json.loads(line)
            print(f"  {d.get('method','?')} {d.get('host','?')}{d.get('path','?')}")
        except: pass
else:
    print("\n捕获文件为空")

import os
