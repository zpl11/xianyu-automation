"""
查找 mitmproxy CA 证书位置并导出
"""
import os

# Check common locations
paths = [
    os.path.expanduser('~/.mitmproxy'),
    'C:/Users/a2641/.mitmproxy',
    os.environ.get('HOME', '') + '/.mitmproxy',
    os.environ.get('USERPROFILE', '') + '/.mitmproxy',
]

print('查找 mitmproxy CA 证书...')
print()

found = False
for p in paths:
    if p and os.path.exists(p):
        print(f'目录: {p}')
        for f in os.listdir(p):
            if 'mitm' in f.lower() or 'ca' in f.lower():
                fp = os.path.join(p, f)
                size = os.path.getsize(fp)
                print(f'  📄 {f:30s} {size:>8,} bytes')
                found = True
                
                # Copy cert to project for easy access
                if f.endswith('.pem') and 'cert' in f.lower():
                    import shutil
                    dst = os.path.join(os.getcwd(), 'mitmproxy-ca-cert.pem')
                    shutil.copy2(fp, dst)
                    print(f'     → 已复制到: {dst}')
        print()

if not found:
    print('❌ 未找到 mitmproxy CA 证书')
    print()
    print('可能原因: mitmproxy 尚未启动过')
    print('请先启动一次: mitmproxy --listen-port 8890')
    print()
    print('或者从以下位置手动查找:')
    for p in paths:
        if p:
            print(f'  {p}')
