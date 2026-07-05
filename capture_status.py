"""
捕获状态面板
============
显示 mitmproxy 捕获系统的实时状态
"""
import os
import glob
import json
import socket
from datetime import datetime

PROXY_PORT = 8890
WEB_PORT = 8891
CAPTURE_DIR = '.'


def check_port(port):
    """检查端口是否开放"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    result = sock.connect_ex(('127.0.0.1', port))
    sock.close()
    return result == 0


def get_capture_stats():
    """获取捕获统计"""
    files = sorted(glob.glob(os.path.join(CAPTURE_DIR, 'captured_apis_*.jsonl')),
                   key=os.path.getctime)
    
    total_size = 0
    total_records = 0
    db_size = 0
    
    for f in files:
        size = os.path.getsize(f)
        total_size += size
        with open(f, 'r', encoding='utf-8') as fh:
            for line in fh:
                if line.strip():
                    total_records += 1
        
        # DB文件
    db_files = glob.glob(os.path.join(CAPTURE_DIR, 'captured_stats.json'))
    if db_files:
        db_size = os.path.getsize(db_files[0])
    
    return {
        'file_count': len(files),
        'total_size': total_size,
        'total_records': total_records,
        'latest_file': files[-1] if files else None,
        'latest_file_size': os.path.getsize(files[-1]) if files else 0,
    }


def main():
    print('=' * 55)
    print('  闲鱼 API 流量捕获系统 - 状态面板')
    print('=' * 55)
    print(f'  检查时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print()
    
    # 1. 代理状态
    print('📡 代理服务器')
    proxy_ok = check_port(PROXY_PORT)
    web_ok = check_port(WEB_PORT)
    print(f'  代理端口: {PROXY_PORT} → {"✅ 运行中" if proxy_ok else "❌ 未运行"}')
    print(f'  Web界面:  http://127.0.0.1:{WEB_PORT} → {"✅ 可访问" if web_ok else "❌ 不可达"}')
    print(f'  代理地址: 192.168.1.102:{PROXY_PORT} (给平板配置)')
    
    # 1.5 证书服务
    print()
    print('🔑 证书服务')
    cert_ok = check_port(8892)
    print(f'  端口 8892 → {"✅ 可下载证书" if cert_ok else "❌ 未运行"}')
    if cert_ok:
        print(f'  平板访问: http://192.168.1.102:8892/')
    
    # 2. 捕获状态
    print()
    print('📥 数据捕获')
    stats = get_capture_stats()
    print(f'  捕获文件数: {stats["file_count"]}')
    print(f'  总记录数:   {stats["total_records"]}')
    print(f'  总数据量:   {stats["total_size"]:,} bytes')
    if stats['latest_file']:
        print(f'  最新文件:   {os.path.basename(stats["latest_file"])}')
        print(f'  最新大小:   {stats["latest_file_size"]:,} bytes')
    
    # 3. 平板状态
    print()
    print('📱 平板连接')
    try:
        import uiautomator2 as u2
        d = u2.connect('192.168.1.58')
        info = d.info
        proxy_setting = d.shell(['settings', 'get', 'global', 'http_proxy']).output.strip()
        print(f'  设备: {info.get("productName", "?")} {info.get("displayWidth", "?")}x{info.get("displayHeight", "?")}')
        try:
            battery = d.battery
        except:
            battery = {'level': '?'}
        print(f'  电池: {battery.get("level", "?")}%')
        print(f'  代理: {"✅ " + proxy_setting if proxy_setting else "❌ 未设置代理"}')
    except Exception as e:
        print(f'  ❌ 连接失败: {e}')
    
    # 4. 操作指引
    print()
    print('=' * 55)
    print('  📋 操作指引')
    print('=' * 55)
    print()
    print('  1️⃣  安装 CA 证书 (必须):')
    print('     平板浏览器打开: http://192.168.1.102:8892/')
    print('     点击 "下载 CA 证书" 按钮')
    print('     设置 → 安全 → 加密与凭据 → 安装证书 → CA证书')
    print('     (注意: 如果先在浏览器设置代理，也可访问 http://mitm.it)')
    print()
    print('  2️⃣  浏览闲鱼:')
    print('     打开闲鱼App并自由操作')
    print('     - 浏览商品列表 (搜索)')
    print('     - 查看商品详情 (点击商品)')
    print('     - 查看某个店铺')
    print()
    print('  3️⃣  查看捕获数据:')
    print(f'     Web界面: http://127.0.0.1:{WEB_PORT}')
    print('     分析命令: python analyze_captured_apis.py')
    print('     持续监控: python analyze_captured_apis.py --watch')
    print()
    print('  4️⃣  停止捕获:')
    print('     关闭CMD窗口，或 taskkill /F /IM python.exe')
    print()
    print('=' * 55)


if __name__ == '__main__':
    main()
