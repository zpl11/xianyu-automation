"""
平板已连接 + 代理已设置 → 打开闲鱼App浏览商品 → 捕获API流量
"""
import uiautomator2 as u2
import time
import json
import glob
import os
import re

d = u2.connect("192.168.1.58")
ITEM_ID = "1008750028209"

print("1. 确认代理...")
r = d.shell(["settings", "get", "global", "http_proxy"])
print(f"   代理: {r.output.strip()}")

# 记录已有的捕获文件数
before = len(glob.glob("captured_apis_*.jsonl"))

print("2. 打开闲鱼App...")
d.app_start("com.taobao.idlefish")
time.sleep(3)

print(f"3. 打开商品详情 (ID: {ITEM_ID})...")
d.shell(["am", "start", "-a", "android.intent.action.VIEW",
         "-d", f"goofish://item/{ITEM_ID}",
         "-p", "com.taobao.idlefish"])
time.sleep(8)

# 尝试读取UI上的统计数字
print("4. 读取UI统计数据...")
xml = d.dump_hierarchy()
for kw, name in [("浏览","views"),("想要","wants"),("收藏","favs"),("留言","comments"),("评价","reviews")]:
    idx = xml.find(kw)
    if idx >= 0:
        chunk = xml[max(0,idx-40):idx+40]
        nums = re.findall(r'(\d+)', chunk)
        print(f"   {name}: {nums[-1] if nums else '?'} (附近: ...{chunk.strip()[:60]}...)")
    else:
        print(f"   {name}: 未找到")

print("5. 检查新捕获文件...")
after = len(glob.glob("captured_apis_*.jsonl"))
if after > before:
    files = sorted(glob.glob("captured_apis_*.jsonl"), key=os.path.getctime)
    latest = files[-1]
    with open(latest, encoding='utf-8') as f:
        lines = f.readlines()
    new_lines = [l for l in lines if l.strip()]
    apis = {}
    for line in new_lines:
        try:
            d = json.loads(line)
            if d.get('api_name'):
                apis[d['api_name']] = apis.get(d['api_name'], 0) + 1
            # 也检查5维数据
            if d.get('5dim_data'):
                dim5 = d['5dim_data']
                print(f"   5维数据: {dim5}")
        except: pass
    if apis:
        print(f"   捕获到 {len(apis)} 个API:")
        for api, cnt in sorted(apis.items(), key=lambda x: -x[1])[:15]:
            print(f"     {api} x{cnt}")
    else:
        print(f"   文件有 {len(new_lines)} 行")
        # 显示前几行
        for line in new_lines[:5]:
            print(f"     {line[:100]}")
else:
    print("   无新捕获文件（App可能不走代理）")

print("\n✅ 完成")
