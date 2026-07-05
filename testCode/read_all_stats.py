"""
从平板App界面读取所有统计数字
使用多种搜索策略
"""
import uiautomator2 as u2
import re
import time

d = u2.connect("192.168.1.58")
ITEM_ID = "1008750028209"

# 打开商品
d.shell(["am", "start", "-a", "android.intent.action.VIEW",
         "-d", f"goofish://item/{ITEM_ID}",
         "-p", "com.taobao.idlefish"])
time.sleep(6)

xml = d.dump_hierarchy()

print("=== 商品页全部文本（含数字）===\n")
texts = []
for line in xml.split("<"):
    m = re.search(r'text="([^"]*)"', line)
    if m and m.group(1).strip():
        texts.append(m.group(1).strip())

# 显示所有含数字的文本
for t in texts:
    if re.search(r'\d+', t):
        print(f"  {t}")

print("\n=== 关键词匹配 ===\n")
keywords = ["浏览", "想要", "收藏", "留言", "评价", "人想要", "条留言", "次浏览"]
for kw in keywords:
    idx = xml.find(kw)
    if idx >= 0:
        chunk = xml[max(0, idx-60):idx+60]
        # 提取所有数字
        nums = re.findall(r'>?(\d+)<?', chunk)
        print(f"  '{kw}': 附近数字 {nums}  | 上下文: ...{chunk.strip()[:80]}...")
    else:
        print(f"  '{kw}': ✗ 未找到")

print("\n=== 所有数值型 attributes ===\n")
# 直接搜索 number类型的属性
for attr in ["count", "num", "Cnt", "favor", "interact", "comment", "review", "evaluate"]:
    indices = [i for i, t in enumerate(texts) if attr.lower() in t.lower()]
    if indices:
        for i in indices:
            print(f"  '{attr}' in text: {texts[i]}")

print("\n✅ 完成")
