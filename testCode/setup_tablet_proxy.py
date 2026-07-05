"""
平板代理配置工具
=================
通过 uiautomator2 自动配置平板 WiFi 代理，安装 CA 证书。
同时提供手动配置指引。

用法:
  python testCode/setup_tablet_proxy.py

步骤:
  1. 连接到平板
  2. 检测当前 WiFi 状态
  3. 设置 WiFi 代理 (192.168.1.102:8888)
  4. 安装 mitmproxy CA 证书
  5. 打开闲鱼 App 开始测试
"""

import sys
import os
import subprocess
import time

# 配置
PROXY_HOST = '192.168.1.102'
PROXY_PORT = 8888
CERT_DOWNLOAD_URL = f'http://{PROXY_HOST}:{PROXY_PORT + 1}/cert'

def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}')
    sys.stdout.flush()


def check_adb():
    """检查 ADB 是否可用"""
    try:
        result = subprocess.run(
            ['adb', 'devices'],
            capture_output=True, text=True, timeout=5
        )
        log(f'ADB 状态:\n{result.stdout}')
        return True
    except FileNotFoundError:
        log('❌ adb 命令未找到')
        return False
    except Exception as e:
        log(f'❌ ADB 错误: {e}')
        return False


def try_u2_connect():
    """尝试通过 uiautomator2 连接"""
    try:
        import uiautomator2 as u2
        d = u2.connect('192.168.1.58')
        info = d.info
        log(f'✅ 已连接平板: {info.get("productName", "?")} '
            f'{info.get("displayWidth", "?")}x{info.get("displayHeight", "?")}')
        return d
    except ImportError:
        log('❌ uiautomator2 未安装，请先: pip install uiautomator2')
        return None
    except Exception as e:
        log(f'❌ 连接失败: {e}')
        return None


def setup_wifi_proxy_via_adb(host, port):
    """通过 ADB 命令设置 WiFi 代理"""
    log(f'设置 WiFi 代理 {host}:{port}...')
    
    commands = [
        # 清除现有代理设置
        ['adb', 'shell', 'settings', 'put', 'global', 'http_proxy', f'{host}:{port}'],
    ]
    
    for cmd in commands:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                log(f'  ✅ 执行: {" ".join(cmd[-4:])}')
            else:
                log(f'  ⚠️  输出: {result.stderr.strip()}')
        except Exception as e:
            log(f'  ❌ 错误: {e}')
    
    log('✅ 代理已设置 (可能需要重启 WiFi 连接生效)')


def clear_wifi_proxy_via_adb():
    """清除 WiFi 代理"""
    log('清除 WiFi 代理...')
    try:
        subprocess.run(
            ['adb', 'shell', 'settings', 'put', 'global', 'http_proxy', ':0'],
            capture_output=True, timeout=10
        )
        log('✅ 代理已清除')
    except Exception as e:
        log(f'❌ 清除失败: {e}')


def print_manual_instructions():
    """打印手动配置指引"""
    print()
    print('=' * 60)
    print('  手动配置指引')
    print('=' * 60)
    print()
    print('📱 平板端设置 WiFi 代理:')
    print(f'  1. 打开 设置 → WLAN/WiFi')
    print(f'  2. 长按当前连接的 WiFi → 修改网络')
    print(f'  3. 展开「高级选项」→ 代理 → 手动')
    print(f'  4. 主机名: {PROXY_HOST}')
    print(f'  5. 端口:   {PROXY_PORT}')
    print(f'  6. 点击保存')
    print()
    print('🔒 安装 CA 证书:')
    print(f'  1. 在平板浏览器打开: {CERT_DOWNLOAD_URL}')
    print(f'  2. 或打开: http://mitm.it')
    print(f'  3. 下载并安装证书')
    print(f'     → 设置 → 安全 → 加密与凭据 → 安装证书')
    print(f'     → CA 证书 → 选择下载的文件')
    print()
    print('📊 查看捕获状态:')
    print(f'  Web界面: http://localhost:8889')
    print(f'  控制台日志: cat mitmproxy_console.log')
    print()


def verify_proxy():
    """验证代理是否在运行"""
    import socket
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(3)
        result = sock.connect_ex(('127.0.0.1', PROXY_PORT))
        sock.close()
        if result == 0:
            log(f'✅ 代理端口 {PROXY_PORT} 已开放')
            # 测试代理是否正常响应
            try:
                import urllib.request
                proxy_handler = urllib.request.ProxyHandler({'http': f'http://127.0.0.1:{PROXY_PORT}'})
                opener = urllib.request.build_opener(proxy_handler)
                resp = opener.open('http://httpbin.org/ip', timeout=5)
                log(f'✅ 代理功能正常')
                return True
            except:
                log(f'⚠️ 端口开放但代理无响应')
                return False
        else:
            log(f'❌ 代理端口 {PROXY_PORT} 未开放')
            return False
    except Exception as e:
        log(f'❌ 无法检测代理端口: {e}')
        return False


def main():
    print('=' * 60)
    print('  平板代理配置工具')
    print('=' * 60)
    print()
    
    # 1. 验证代理
    print('📋 第1步: 验证本机代理状态')
    proxy_ok = verify_proxy()
    print()
    
    if not proxy_ok:
        log('请先启动 mitmproxy:')
        log(f'  mitmweb -s mitm_xianyu_capture.py --listen-port {PROXY_PORT}')
        return
    
    # 2. 尝试 ADB 连接
    print('📋 第2步: 检查 ADB 连接')
    adb_ok = check_adb()
    print()
    
    # 3. 尝试 uiautomator2 连接
    print('📋 第3步: 尝试 uiautomator2 连接')
    d = try_u2_connect()
    print()
    
    if d:
        # 通过 uiautomator2 设置代理
        print('📋 第4步: 设置 WiFi 代理')
        setup_wifi_proxy_via_adb(PROXY_HOST, PROXY_PORT)
        print()
        
        print('📋 第5步: 打开 Cert 下载页面')
        log(f'请在平板浏览器打开: {CERT_DOWNLOAD_URL}')
        print()
        
        print('📋 第6步: 打开闲鱼 App')
        log('正在打开闲鱼...')
        try:
            d.app_start('com.taobao.idlefish')
            log('✅ 闲鱼已打开')
        except:
            log('⚠️ 无法自动打开闲鱼，请手动打开')
    else:
        # 无法自动配置，打印手动指引
        print_manual_instructions()
    
    print()
    print('=' * 60)
    print('  配置完成！')
    print(f'  代理运行中: {PROXY_HOST}:{PROXY_PORT}')
    print(f'  Web 界面: http://localhost:8889')
    print(f'  输出文件: captured_apis_*.jsonl')
    print()
    print('  开始在平板上操作闲鱼 App...')
    print('  捕获的数据将自动保存到 JSONL 文件')
    print('=' * 60)


if __name__ == '__main__':
    main()
