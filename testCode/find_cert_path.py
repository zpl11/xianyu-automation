"""
在华为平板上找到安装CA证书的正确路径
"""
import uiautomator2 as u2
import time
import re

d = u2.connect("192.168.1.58")

def dump_screen(label):
    """显示当前屏幕的按钮和文本"""
    xml = d.dump_hierarchy()
    texts = []
    for line in xml.split("<"):
        m = re.search(r'text="([^"]*)"', line)
        if m and m.group(1).strip() and len(m.group(1)) > 1:
            texts.append(m.group(1).strip())
    print(f"\n=== {label} ===")
    for t in texts[:30]:
        print(f"  {t}")

# 先看当前在哪个页面
dump_screen("当前屏幕")

# 尝试打开安全设置的不同路径
print("\n\n尝试打开安全设置...")
d.shell(["am", "start", "-a", "android.settings.SECURITY_SETTINGS"])
time.sleep(3)
dump_screen("安全设置")

# 找"更多设置"或"高级设置"
for keyword in ["更多", "高级", "加密", "凭据", "证书", "安全", "信任"]:
    btn = d(textContains=keyword)
    if btn.exists:
        print(f"\n点击: {keyword}")
        btn.click()
        time.sleep(2)
        dump_screen(f"点击{keyword}后")
        break

# 再找"安装证书"或"从存储设备安装"
for keyword in ["安装证书", "从存储", "从SD", "CA证书", "安装", "凭据存储"]:
    btn = d(textContains=keyword)
    if btn.exists:
        print(f"\n点击: {keyword}")
        btn.click()
        time.sleep(2)
        dump_screen(f"点击{keyword}后")
        break
