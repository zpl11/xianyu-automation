"""
通过 iptables 强制重定向闲鱼 App 流量到代理
需要 ADB 和 iptables 支持（大多数 Android 设备支持）
"""
import uiautomator2 as u2
import time

d = u2.connect("192.168.1.58")
PROXY_IP = "192.168.1.102"
PROXY_PORT = 8890

def run(cmd):
    result = d.shell(cmd)
    if result.exit_code == 0:
        print(f"  ✅ {cmd[0]} ... {cmd[-1] if len(cmd) > 1 else ''}")
    else:
        print(f"  ⚠️  {cmd[0]}: {result.stderr[:100] if result.stderr else result.output[:100]}")
    return result

print("=" * 50)
print("通过 iptables 重定向闲鱼流量到代理")
print("=" * 50)
print()

# 1. 检查 iptables 是否可用
print("1. 检查 iptables...")
result = run(["iptables", "-L", "-n", "-t", "nat"])
if result.exit_code != 0:
    print("   ❌ iptables 不可用，尝试使用 uid 重定向...")
    # 尝试获取 Xianyu 的 UID
    uid_result = d.shell(["pm", "list", "packages", "-U", "com.taobao.idlefish"])
    print(f"   获取UID: {uid_result.output}")
else:
    print("   ✅ iptables 可用")

# 2. 获取闲鱼 App 的 UID
print("\n2. 获取闲鱼 App UID...")
result = d.shell(["ps", "-ef", "|", "grep", "idlefish"])
for line in result.output.split("\n"):
    if "idlefish" in line:
        print(f"   {line}")

# 3. 尝试通过 iptables 添加重定向规则
print("\n3. 添加 iptables 规则 (需要 root)...")
cmds = [
    ["iptables", "-t", "nat", "-A", "OUTPUT", "-p", "tcp", "--dport", "80",
     "-j", "DNAT", "--to-destination", f"{PROXY_IP}:{PROXY_PORT}"],
    ["iptables", "-t", "nat", "-A", "OUTPUT", "-p", "tcp", "--dport", "443",
     "-j", "DNAT", "--to-destination", f"{PROXY_IP}:{PROXY_PORT}"],
]

for cmd in cmds:
    d.shell(cmd)

# 4. 设置系统代理（双重保障）
print("\n4. 设置系统代理...")
d.shell(["settings", "put", "global", "http_proxy", f"{PROXY_IP}:{PROXY_PORT}"])
time.sleep(1)
proxy = d.shell(["settings", "get", "global", "http_proxy"])
print(f"   当前代理: {proxy.output.strip()}")

print("\n5. 清除 iptables 规则")
cmds = [
    ["iptables", "-t", "nat", "-D", "OUTPUT", "-p", "tcp", "--dport", "80",
     "-j", "DNAT", "--to-destination", f"{PROXY_IP}:{PROXY_PORT}"],
    ["iptables", "-t", "nat", "-D", "OUTPUT", "-p", "tcp", "--dport", "443",
     "-j", "DNAT", "--to-destination", f"{PROXY_IP}:{PROXY_PORT}"],
]

# 保存清理命令以备后用
with open("cleanup_iptables.txt", "w") as f:
    for cmd in cmds:
        f.write(" ".join(cmd) + "\n")
print("   清理命令已保存到 cleanup_iptables.txt")

print()
print("✅ 流量重定向配置完成")
print("请在平板上操作闲鱼App，流量将被强制经过代理")
