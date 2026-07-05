"""
通过 ADB 推送证书到平板并触发安装
"""
import uiautomator2 as u2
import time

d = u2.connect("192.168.1.58")

print("1. 推送证书到平板...")
d.push("mitmproxy-ca-cert.pem", "/sdcard/Download/mitmproxy-ca-cert.pem")
print("   证书已推送")

print("2. 打开证书安装界面...")
d.shell(["am", "start", "-a", "android.intent.action.VIEW",
         "-d", "file:///sdcard/Download/mitmproxy-ca-cert.pem",
         "-t", "application/x-x509-ca-cert"])
time.sleep(3)

print("3. 尝试自动点击安装...")
# 找"安装"按钮
btn = d(text="安装")
if btn.exists:
    btn.click()
    print("   已点击安装")
    time.sleep(2)
else:
    print("   未找到安装按钮，请手动点击")

print("\n✅ 完成")
print("如果自动安装失败，请手动：")
print("  设置 → 安全 → 加密与凭据 → 安装证书 → CA证书")
print("  选择 /sdcard/Download/mitmproxy-ca-cert.pem")
