"""
启动 mitmproxy 流量捕获
用法: python start_capture.py
"""
import subprocess
import sys
import os
import time
import signal

os.chdir(os.path.dirname(os.path.abspath(__file__)))

LOG_FILE = 'mitmproxy_console.log'

def main():
    print("=" * 50)
    print("  闲鱼 API 流量捕获启动器")
    print("=" * 50)
    print()
    
    # 检查端口
    import socket
    for port in [8890, 8891]:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        result = sock.connect_ex(('127.0.0.1', port))
        sock.close()
        if result == 0:
            print(f"⚠️  端口 {port} 已被占用，尝试关闭旧进程...")
            if sys.platform == 'win32':
                subprocess.run(f'cmd /c "netstat -ano | findstr :{port}"', shell=True)
    
    # 启动 mitmweb
    print(f"启动 mitmweb...")
    print(f"  代理端口: 8890")
    print(f"  Web界面:  http://127.0.0.1:8891")
    print(f"  插件:     mitm_xianyu_capture.py")
    print()
    
    log_file = open(LOG_FILE, 'w', encoding='utf-8')
    
    proc = subprocess.Popen(
        [sys.executable, '-m', 'mitmproxy.tools.main', 'web',
         '-s', 'mitm_xianyu_capture.py',
         '--listen-port', '8890',
         '--web-host', '127.0.0.1',
         '--web-port', '8891'],
        stdout=log_file,
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == 'win32' else 0
    )
    
    print(f"✅ 已启动 (PID: {proc.pid})")
    print()
    print("等待启动...")
    time.sleep(3)
    
    # 验证启动
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    result = sock.connect_ex(('127.0.0.1', 8890))
    sock.close()
    
    if result == 0:
        print("✅ 代理端口 8890 已开放")
        print("✅ 捕获系统运行中！")
        print()
    else:
        print("❌ 代理未能启动，检查日志:")
        with open(LOG_FILE, 'r', encoding='utf-8') as f:
            print(f.read())
        return
    
    print("📋 使用说明:")
    print(f"  1. 平板 WiFi 代理设置: IP=192.168.1.102 端口=8890")
    print(f"  2. 安装CA证书: 平板浏览器打开 http://mitm.it")
    print(f"  3. Web界面:  http://127.0.0.1:8891")
    print(f"  4. 捕获数据: 查看 captured_apis_*.jsonl")
    print(f"  5. 停止捕获: 按 Ctrl+C")
    print()
    
    try:
        # 保持运行
        while True:
            time.sleep(1)
            if proc.poll() is not None:
                print(f"❌ 进程已退出 (code: {proc.returncode})")
                with open(LOG_FILE, 'r', encoding='utf-8') as f:
                    print(f.read())
                break
    except KeyboardInterrupt:
        print("\n正在停止...")
        if sys.platform == 'win32':
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            proc.terminate()
        proc.wait()
        print("✅ 已停止")

if __name__ == '__main__':
    main()
