"""
通过 uiautomator2 设置平板 WiFi 代理
"""
import uiautomator2 as u2
import time

d = u2.connect('192.168.1.58')

# 方法1: 通过 settings API 设置全局代理
print('方法1: 通过系统设置设置代理...')
result = d.shell(['settings', 'put', 'global', 'http_proxy', '192.168.1.102:8888'])
print(f'  结果: {result}')

time.sleep(1)

# 验证
result2 = d.shell(['settings', 'get', 'global', 'http_proxy'])
print(f'  当前代理: {result2}')

if '192.168.1.102:8888' in result2:
    print('✅ 代理已设置成功！')
else:
    print('⚠️ 方法1可能未生效，平板可能需要重启WiFi')

print()
print('请在平板浏览器打开: http://192.168.1.102:8889/')
print('下载并安装CA证书')
print()
print('然后在闲鱼App中自由操作，流量将被自动捕获')
