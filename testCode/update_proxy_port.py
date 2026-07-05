"""
更新平板代理端口 (8888 -> 8890)
"""
import uiautomator2 as u2
import time

d = u2.connect('192.168.1.58')

# 更新代理端口
print('更新平板代理端口...')
result = d.shell(['settings', 'put', 'global', 'http_proxy', '192.168.1.102:8890'])
print(f'  执行结果: {result}')

time.sleep(1)

# 验证
result2 = d.shell(['settings', 'get', 'global', 'http_proxy'])
print(f'  当前代理: {result2}')

if '192.168.1.102:8890' in result2:
    print('✅ 代理端口已更新为 8890')
else:
    print('⚠️ 更新可能未生效')

print()
print('请在闲鱼App中自由操作，流量将被自动捕获到 captured_apis_*.jsonl')
print('查看Web界面: http://127.0.0.1:8891')
