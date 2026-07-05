"""
华为 MatePad Pro 安装 CA 证书的路径
"""
import uiautomator2 as u2
import time
import re

d = u2.connect("192.168.1.58")

def show_screen(label):
    xml = d.dump_hierarchy()
    texts = []
    for line in xml.split("<"):
        m = re.search(r'text="([^"]*)"', line)
        if m and m.group(1).strip() and len(m.group(1)) > 1:
            texts.append(m.group(1).strip())
    print(f"\n=== {label} ===")
    for t in texts[:25]:
        print(f"  {t}")

# 确保在安全设置
d.shell(["am", "start", "-a", "android.settings.SECURITY_SETTINGS"])
time.sleep(3)

# 点"其他"（华为的更多设置）
other = d(text="其他")
if other.exists:
    print("点击: 其他")
    other.click()
    time.sleep(2)
    show_screen("其他设置")

# 找"加密和凭据"或类似选项
for kw in ["加密", "凭据", "证书", "更多安全"]:
    btn = d(textContains=kw)
    if btn.exists:
        print(f"\n点击: {kw}")
        btn.click()
        time.sleep(2)
        show_screen(f"点击{kw}后")
        break

# 找"安装证书"
for kw in ["安装证书", "从存储", "从SD", "安装"]:
    btn = d(textContains=kw)
    if btn.exists:
        print(f"\n点击: {kw}")
        btn.click()
        time.sleep(2)
        show_screen(f"点击{kw}后")
        break

# 找"CA证书"
for kw in ["CA", "ca"]:
    btn = d(textContains=kw)
    if btn.exists:
        print(f"\n点击: {kw}")
        btn.click()
        time.sleep(2)
        show_screen("点击CA后")
        break
