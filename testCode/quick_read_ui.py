"""
快速从平板读取商品详情页的统计数字
不重启WiFi，只打开App和读取UI
"""
import uiautomator2 as u2
import re

d = u2.connect("192.168.1.58")
item_id = "1008750028209"

# 打开商品页
d.shell(["am", "start", "-a", "android.intent.action.VIEW",
         "-d", f"https://www.goofish.com/item/{item_id}"])
import time; time.sleep(6)

# 读取UI文本
xml = d.dump_hierarchy()

# 提取所有可见文本
texts = []
for line in xml.split("<"):
    m = re.search(r'text="([^"]*)"', line)
    if m and m.group(1).strip():
        texts.append(m.group(1).strip())

print("页面文本（含数字+关键词的）:")
for t in texts:
    if any(kw in t for kw in ["浏览","想要","收藏","留言","评价","人想要","条留言"]):
        print(f"  {t}")

print("\n原始正则匹配:")
for pattern, name in [
    (r'(\d+)\s*次?浏览', '浏览'),
    (r'(\d+)\s*人?想要', '想要'),
    (r'(\d+)\s*人?收藏', '收藏'),
    (r'(\d+)\s*条?留言', '留言'),
    (r'(\d+)\s*次?评价', '评价'),
]:
    m = re.search(pattern, xml)
    if m:
        print(f"  {name}: {m.group(1)}")
    else:
        print(f"  {name}: 未找到")
