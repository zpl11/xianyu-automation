"""
直接通过 URL Scheme 在平板上打开商品详情页
然后提取界面显示的统计数据（包括留言数）
"""
import uiautomator2 as u2
import time
import re
import sys

d = u2.connect("192.168.1.58")

item_id = sys.argv[1] if len(sys.argv) > 1 else "1054944275429"

# 通过 ADB 直接打开商品（绕过搜索）
print(f"直接打开商品 {item_id}...")
result = d.shell([
    "am", "start", "-a", "android.intent.action.VIEW",
    "-d", f"https://www.goofish.com/item/{item_id}"
])
print(f"  ADB: {result.output}")

time.sleep(5)

# 提取界面文本
print("\n提取界面统计数据...")
xml = d.dump_hierarchy()

# 提取所有文本
texts = []
for line in xml.split("<"):
    m = re.search(r'text="([^"]*)"', line)
    if m and m.group(1).strip():
        texts.append(m.group(1).strip())

# 找包含数字+统计关键词的文本
for text in texts:
    if any(kw in text for kw in ["浏览", "想要", "收藏", "留言", "评价", "人想要", "条留言"]):
        nums = re.findall(r'\d+', text)
        if nums:
            print(f"  {text}")

# 也搜索原始 XML 中的统计数字
print("\n原始匹配:")
patterns = [
    (r"(\d+)\s*次?浏览", "浏览"),
    (r"(\d+)\s*人?想要", "想要"),
    (r"(\d+)\s*人?收藏", "收藏"),
    (r"(\d+)\s*条?留言", "留言"),
    (r"(\d+)\s*条?评价", "评价"),
]
for pattern, name in patterns:
    m = re.search(pattern, xml)
    if m:
        print(f"  {name}: {m.group(1)}")

# 备选：直接搜 "留言" 附近的数字
print("\n'留言'附近文本:")
idx = xml.find("留言")
if idx > 0:
    chunk = xml[max(0, idx-100):idx+100]
    # 找数字
    for n in re.findall(r'>?(\d+)<', chunk):
        print(f"  数字: {n}")
    print(f"  上下文: ...{chunk[:200]}...")
else:
    print("  (未找到'留言'文本)")
    
print("\n完成")
