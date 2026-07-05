"""
滚动安全设置页面，找到证书安装选项
"""
import uiautomator2 as u2
import time
import re

d = u2.connect("192.168.1.58")

def show_visible_texts(label):
    xml = d.dump_hierarchy()
    texts = []
    for line in xml.split("<"):
        m = re.search(r'text="([^"]*)"', line)
        if m and m.group(1).strip() and len(m.group(1)) > 1:
            texts.append(m.group(1).strip())
    # 去重但保持顺序
    seen = set()
    unique = []
    for t in texts:
        if t not in seen:
            seen.add(t)
            unique.append(t)
    print(f"\n=== {label} ({len(unique)}项) ===")
    for t in unique[:40]:
        print(f"  {t}")

# 回到安全设置首页
d.shell(["am", "start", "-a", "android.settings.SECURITY_SETTINGS"])
time.sleep(3)
show_visible_texts("安全设置首页")

# 滚动到页面底部（华为的"更多设置"可能在下面）
w = d.info.get("displayWidth", 1600)
h = d.info.get("displayHeight", 2560)
for i in range(3):
    d.swipe(w // 2, h * 3 // 4, w // 2, h // 4, duration=0.3)
    time.sleep(1)
show_visible_texts("滚动后底部")

# 找关键词
keywords_found = []
xml = d.dump_hierarchy()
for kw in ["加密", "凭据", "证书", "安装证书", "更多设置", "更多安全", "信任", "受信任"]:
    if kw in xml:
        keywords_found.append(kw)
if keywords_found:
    print(f"\n找到关键词: {keywords_found}")
else:
    print("\n未找到任何证书相关关键词")
    print("华为MatePad Pro安装CA证书的路径可能是:")
    print("  设置 → 安全 → 更多安全设置 → 加密和凭据 → 安装证书 → CA证书")
    print("或者直接搜索'安装证书'")
