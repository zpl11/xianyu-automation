"""
切换平板WiFi强制代理生效
"""
import uiautomator2 as u2
import time

d = u2.connect("192.168.1.58")

print("关闭WiFi...")
d.shell(["svc", "wifi", "disable"])
time.sleep(3)

print("开启WiFi...")
d.shell(["svc", "wifi", "enable"])
time.sleep(5)

# 验证代理
proxy = d.shell(["settings", "get", "global", "http_proxy"])
print(f"当前代理: {proxy.output.strip()}")

# 检查IP
ip = d.shell(["ip", "addr", "show", "wlan0"])
for line in ip.output.split("\n"):
    if "inet " in line:
        print(f"IP: {line.strip()}")

print("✅ WiFi已重新连接，代理应已生效")
