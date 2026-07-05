"""
通过 iptables 强制重定向平板流量到 mitmproxy
需要平板 adb 连接且支持 iptables (部分非root设备也可)
"""
import uiautomator2 as u2
import time
import subprocess
import sys

PROXY_IP = "192.168.1.102"
PROXY_PORT = 8890

d = u2.connect("192.168.1.58")

def run_adb(cmd):
    """通过 uiautomator2 执行 ADB shell 命令"""
    result = d.shell(cmd)
    if result.exit_code == 0:
        print(f"  ✅ {cmd[0]} ... OK")
    else:
        print(f"  ⚠️ {cmd[0]}: {str(result.stderr)[:100]}")
    return result

print("=" * 50)
print("  平板流量强制捕获工具")
print("=" * 50)
print()

# 1. 检查 iptables
print("1. 检查 iptables 可用性...")
result = run_adb(["iptables", "-L", "-n", "-t", "nat", "--line-numbers"])
if result.exit_code != 0:
    print("   ❌ iptables 不可用（设备可能未 root）")
    print("   尝试通过 settings 设置代理...")
    run_adb(["settings", "put", "global", "http_proxy", f"{PROXY_IP}:{PROXY_PORT}"])
    time.sleep(1)
    proxy = run_adb(["settings", "get", "global", "http_proxy"])
    print(f"   当前代理: {proxy.output.strip()}")
    print()
    print("   ⚠️ 闲鱼 App 可能不遵守系统代理设置")
    print("   请在平板上打开闲鱼 App 并浏览商品")
    print("   mitmproxy 会在后台尝试捕获流量")
else:
    # 2. 添加 iptables 规则
    print("\n2. 添加 iptables 重定向规则...")
    # 重定向 80 和 443 端口到我们的代理
    cmds = [
        ["iptables", "-t", "nat", "-A", "OUTPUT", "-p", "tcp", "--dport", "80",
         "-j", "DNAT", "--to-destination", f"{PROXY_IP}:{PROXY_PORT}"],
        ["iptables", "-t", "nat", "-A", "OUTPUT", "-p", "tcp", "--dport", "443",
         "-j", "DNAT", "--to-destination", f"{PROXY_IP}:{PROXY_PORT}"],
    ]
    for cmd in cmds:
        run_adb(cmd)
    print("   ✅ iptables 规则已添加")
    print("   ⚠️ 注意：规则会重定向所有流量，可能导致其他网络异常")
    print("   完成后需清除规则")

print()
print("3. 在平板上操作闲鱼 App...")
print(f"   确保 mitmproxy 已在 {PROXY_IP}:{PROXY_PORT} 运行")
print("   打开闲鱼 App → 浏览商品详情页")
print()

# 打开闲鱼 App
d.app_start("com.taobao.idlefish")
time.sleep(2)

print("   ✅ 闲鱼 App 已打开")
print("   请在平板上浏览商品，API 流量将被捕获")
print()
print("   查看捕获数据: python analyze_captured_apis.py")
