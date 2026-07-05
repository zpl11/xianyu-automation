"""
在平板上自动安装 mitmproxy CA 证书
步骤:
  1. 打开浏览器 → 下载证书
  2. 进入设置 → 安装证书
  3. 选择 CA 证书 → 确认安装
"""
import uiautomator2 as u2
import time

d = u2.connect("192.168.1.58")

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")

log("=== 安装 mitmproxy CA 证书 ===\n")

# 1. 打开浏览器下载证书
log("1. 打开证书下载页面...")
d.shell(["am", "start", "-a", "android.intent.action.VIEW",
         "-d", "http://192.168.1.102:8892/"])
time.sleep(3)

# 点击下载按钮（页面上有"下载CA证书"的链接）
log("   点击下载...")
# 查找包含"下载"或"cert"的可点击元素
download_btn = d(textContains="下载")
if download_btn.exists:
    download_btn.click()
    log("   已点击下载")
    time.sleep(3)
else:
    # 直接打开证书文件
    log("   直接打开证书文件...")
    d.shell(["am", "start", "-a", "android.intent.action.VIEW",
             "-d", "http://192.168.1.102:8892/cert"])
    time.sleep(3)

# 2. 进入设置安装证书
log("\n2. 打开设置 → 安装证书...")
d.shell(["am", "start", "-a", "android.settings.SECURITY_SETTINGS"])
time.sleep(3)

# 查找"安装证书"或"加密与凭据"
install_btn = d(textContains="安装证书") or d(textContains="加密") or d(textContains="凭据")
if install_btn:
    log(f"   找到: {install_btn.info.get('text', '?')}")
    install_btn.click()
    time.sleep(2)
else:
    log("   未找到安装证书选项，手动操作")
    log("   请在设置中: 安全 → 加密与凭据 → 安装证书 → CA证书")

# 尝试找到CA证书安装选项
ca_btn = d(textContains="CA证书") or d(textContains="CA")
if ca_btn and ca_btn.exists:
    ca_btn.click()
    time.sleep(2)

# 3. 选择下载的证书文件
log("\n3. 在文件选择器中找到证书...")
# 通常下载的文件在 Download 目录
file_btn = d(textContains="mitmproxy") or d(textContains="cert") or d(textContains=".pem") or d(textContains="下载")
if file_btn and file_btn.exists:
    file_btn.click()
    time.sleep(2)

# 确认安装
confirm_btn = d(text="安装") or d(textContains="确定") or d(text="确认")
if confirm_btn and confirm_btn.exists:
    confirm_btn.click()
    time.sleep(2)

log("\n✅ 证书安装流程已完成")
log("如果未自动安装成功，请手动操作:")
log("  平板浏览器打开: http://192.168.1.102:8892/")
log("  → 下载证书 → 设置 → 安全 → 安装证书 → CA证书")
