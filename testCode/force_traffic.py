"""
通过 iptables 强制重定向平板所有流量到 mitmproxy
不需要root，部分Android设备支持普通用户执行iptables
"""
import uiautomator2 as u2
import time
import socket
import sys

d = u2.connect("192.168.1.58")
PROXY_IP = "192.168.1.102"
PROXY_PORT = 8890

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")
    sys.stdout.flush()

log("=== 强制平板流量走代理 ===")

# 1. 确保 mitmproxy 在运行
sock = socket.socket()
sock.settimeout(3)
result = sock.connect_ex(("127.0.0.1", PROXY_PORT))
sock.close()
if result == 0:
    log(f"✅ mitmproxy 在 8890 端口运行")
else:
    log(f"❌ mitmproxy 未运行，请先启动")
    sys.exit(1)

# 2. 设置系统代理（作为备选）
log("设置系统代理...")
d.shell(["settings", "put", "global", "http_proxy", f"{PROXY_IP}:{PROXY_PORT}"])
time.sleep(0.5)

# 3. 尝试 iptables（不需要root，部分设备可用）
log("尝试 iptables...")
rules = [
    ["iptables", "-t", "nat", "-A", "OUTPUT", "-p", "tcp", "--dport", "80",
     "-j", "DNAT", "--to-destination", f"{PROXY_IP}:{PROXY_PORT}"],
    ["iptables", "-t", "nat", "-A", "OUTPUT", "-p", "tcp", "--dport", "443",
     "-j", "DNAT", "--to-destination", f"{PROXY_IP}:{PROXY_PORT}"],
]

iptables_ok = True
for cmd in rules:
    r = d.shell(cmd)
    if r.exit_code != 0:
        log(f"⚠️ iptables 失败: {cmd[3]} → {str(r.stderr)[:60]}")
        iptables_ok = False
        break
    else:
        log(f"✅ iptables: {cmd[3]} → OK")

if iptables_ok:
    log("✅ iptables 规则已添加！所有流量将经过代理")
else:
    log("⚠️ iptables 不可用，用系统代理")
    # 重启WiFi让代理生效
    log("重启WiFi...")
    d.shell(["svc", "wifi", "disable"])
    time.sleep(2)
    d.shell(["svc", "wifi", "enable"])
    time.sleep(5)
    # 等待平板重新上线
    log("等待平板重新连接...")
    time.sleep(3)
    # 验证连接
    try:
        d2 = u2.connect("192.168.1.58")
        info = d2.info
        log(f"✅ 平板已重新连接: {info.get('productName', '?')}")
    except:
        log("❌ 平板连接丢失，请检查WiFi")
        # 清理iptables
        for cmd in rules:
            d.shell(cmd[:2] + ["-D"] + cmd[2:])
        sys.exit(1)

# 4. 打开闲鱼App
log("打开闲鱼App...")
d.app_start("com.taobao.idlefish")
time.sleep(3)

# 5. 打开商品详情页
log("打开商品详情页...")
item_id = "1008750028209"
d.shell(["am", "start", "-a", "android.intent.action.VIEW",
         "-d", f"goofish://item/{item_id}",
         "-p", "com.taobao.idlefish"])
time.sleep(6)

log("✅ 请在平上查看商品页，API流量已被 mitmproxy 捕获")
log(f"查看捕获: cat captured_apis_*.jsonl")
