"""
快速检查平板状态
"""
import uiautomator2 as u2
import time

d = u2.connect("192.168.1.58")
print("App正在运行:", d.app_current())
info = d.info
print("屏幕尺寸:", info.get("displayWidth"), "x", info.get("displayHeight"))
print("当前前台:", d.app_current().get("package", "?"))
