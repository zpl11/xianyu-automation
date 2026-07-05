"""
检查平板代理设置和网络连通性
"""
import uiautomator2 as u2
import socket
import time

d = u2.connect("192.168.1.58")

# 1. 检查代理设置
proxy = d.shell(["settings", "get", "global", "http_proxy"])
print(f"代理设置: {proxy.output.strip()}")

# 2. 检查当前 WiFi 连接
wifi = d.shell(["dumpsys", "wifi", "|", "grep", "mNetworkInfo"])
print(f"WiFi状态片段: {wifi.output[:200] if wifi.output else 'N/A'}")

# 3. 尝试通过代理的连接测试
import urllib.request
proxy_host = "192.168.1.102"
proxy_port = 8890

# 测试代理是否可达
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(3)
result = sock.connect_ex((proxy_host, proxy_port))
sock.close()
print(f"本机代理可达: {'✅' if result == 0 else '❌'} (code={result})")

# 4. 显示当前前台App
current = d.app_current()
print(f"当前前台: {current.get('package')} / {current.get('activity')}")

# 5. 检查平板IP
ip_result = d.shell(["ip", "addr", "show"])
if ip_result.output:
    for line in ip_result.output.split("\n"):
        if "inet " in line and "127.0.0.1" not in line:
            print(f"平板IP: {line.strip()}")
