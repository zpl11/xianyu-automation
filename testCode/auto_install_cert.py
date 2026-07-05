"""
华为MatePad Pro 自动安装CA证书
路径: 安全 → 更多安全设置 → 加密和凭据 → 安装证书 → CA证书
"""
import uiautomator2 as u2
import time
import re

d = u2.connect("192.168.1.58")

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")

def texts():
    xml = d.dump_hierarchy()
    return list(set(re.findall(r'text="([^"]{2,})"', xml)))

def check(label):
    log(f"当前: {label}")
    time.sleep(1)

# 1. 打开安全设置
log("1. 打开安全设置...")
d.shell(["am", "start", "-a", "android.settings.SECURITY_SETTINGS"])
time.sleep(3)

# 2. 找到并点击"更多安全设置"
log("2. 找更多安全设置...")
# 可能需要滚动到底部
w = d.info.get("displayWidth", 1600)
h = d.info.get("displayHeight", 2560)
for i in range(3):
    btn = d(text="更多安全设置")
    if btn.exists:
        log("   点击: 更多安全设置")
        btn.click()
        time.sleep(2)
        break
    d.swipe(w // 2, h * 3 // 4, w // 2, h // 4, duration=0.3)
    time.sleep(1)
else:
    log("   ❌ 未找到更多安全设置")
    log(f"   可见项: {texts()[:15]}")

# 3. 找"加密和凭据"
log("3. 找加密和凭据...")
for kw in ["加密和凭据", "加密与凭据", "加密"]:
    btn = d(textContains=kw)
    if btn.exists:
        log(f"   点击: {kw}")
        btn.click()
        time.sleep(2)
        break
else:
    log("   ⚠️ 未找到加密和凭据，显示当前页:")
    for t in texts()[:20]:
        log(f"     {t}")

# 4. 找"安装证书"
log("4. 找安装证书...")
for kw in ["安装证书", "从存储设备安装"]:
    btn = d(textContains=kw)
    if btn.exists:
        log(f"   点击: {kw}")
        btn.click()
        time.sleep(2)
        break
else:
    log("   ⚠️ 未找到安装证书")

# 5. 找"CA证书"
log("5. 找CA证书选项...")
for kw in ["CA证书", "CA"]:
    btn = d(text=kw)
    if btn.exists:
        log(f"   点击: {kw}")
        btn.click()
        time.sleep(2)
        break

# 6. 在文件列表中找到证书
log("6. 找证书文件...")
time.sleep(2)
# 可能显示文件选择器
for kw in ["mitmproxy", "mitm", "cert", "pem"]:
    btn = d(textContains=kw)
    if btn.exists:
        log(f"   点击: {btn.info.get('text','?')}")
        btn.click()
        time.sleep(2)
        break

# 7. 确认安装
log("7. 确认安装...")
for kw in ["确定", "安装", "确认", "是"]:
    btn = d(text=kw)
    if btn.exists:
        log(f"   点击: {kw}")
        btn.click()
        time.sleep(2)
        break

log("\n✅ 完成")
log("如果系统提示输入锁屏密码，请输入后继续")
