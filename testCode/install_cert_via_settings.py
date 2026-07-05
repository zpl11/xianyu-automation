"""
通过 uiautomator2 在平板设置中安装CA证书
"""
import uiautomator2 as u2
import time

d = u2.connect("192.168.1.58")

# 1. 打开设置 → 安全
print("打开安全设置...")
d.app_start("com.android.settings")
time.sleep(2)
d.shell(["am", "start", "-a", "android.settings.SECURITY_SETTINGS"])
time.sleep(3)

# 2. 查找并点击"加密与凭据"或"安装证书"
targets = ["加密与凭据", "加密和凭据", "凭据存储", "安装证书", "安装存储证书"]
for target in targets:
    btn = d(textContains=target)
    if btn.exists:
        print(f"点击: {target}")
        btn.click()
        time.sleep(2)
        break

# 3. 找"CA证书"或"从存储设备安装"
targets2 = ["CA证书", "从存储设备安装", "从SD卡安装", "安装"]
for target in targets2:
    btn = d(textContains=target)
    if btn.exists:
        print(f"点击: {target}")
        btn.click()
        time.sleep(2)
        break

# 4. 在文件选择器中找到证书
# 通常文件列表会显示下载的文件
time.sleep(2)
print("当前屏幕元素:")
xml = d.dump_hierarchy()
# 查找文件列表
mitm = d(textContains="mitm")
if mitm.exists:
    print("找到mitmproxy证书文件")
    mitm.click()
    time.sleep(2)
else:
    # 可能需要在文件列表中浏览
    cert = d(textContains="cert")
    if cert.exists:
        cert.click()
        time.sleep(2)

# 5. 确认安装
ok = d(text="确定") or d(text="安装") or d(text="确定")
if ok and ok.exists:
    ok.click()
    time.sleep(2)
    print("已确认安装")

print("\n完成")
print("请检查平板是否提示证书已安装")
