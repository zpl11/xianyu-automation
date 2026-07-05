"""
提供 mitmproxy CA 证书下载服务
方便平板安装证书以解密 HTTPS 流量

用法:
  python serve_cert.py

平板浏览器打开: http://192.168.1.102:8892/
"""
import http.server
import os
import sys

PORT = 8892
CERT_FILE = 'mitmproxy-ca-cert.pem'

class CertHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/cert' or self.path == '/mitmproxy-ca-cert.pem':
            # Serve the cert file
            try:
                with open(CERT_FILE, 'rb') as f:
                    cert_data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/x-x509-ca-cert')
                self.send_header('Content-Disposition', 'attachment; filename="mitmproxy-ca-cert.pem"')
                self.send_header('Content-Length', str(len(cert_data)))
                self.end_headers()
                self.wfile.write(cert_data)
                print(f'[CERT] 已提供证书下载')
            except FileNotFoundError:
                self.send_error(404, 'Certificate file not found')
        else:
            # Show download page
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            html = f'''<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>mitmproxy CA 证书安装</title></head>
<body style="font-family:sans-serif;padding:20px;max-width:600px;margin:auto">
<h2>🔒 mitmproxy CA 证书下载</h2>
<p>平板安装此证书后，可以解密闲鱼 App 的 HTTPS 流量。</p>
<p><a href="/cert" style="display:inline-block;padding:12px 24px;background:#4CAF50;color:white;
  text-decoration:none;border-radius:4px;font-size:18px">📥 下载 CA 证书</a></p>
<h3>安装步骤:</h3>
<ol>
  <li>点击上方按钮下载证书</li>
  <li>打开平板「设置」→「安全」→「加密与凭据」</li>
  <li>选择「安装证书」→「CA 证书」</li>
  <li>选择刚下载的证书文件</li>
  <li>确认安装（系统会弹出安全警告，选择「安装」）</li>
</ol>
<h3>验证:</h3>
<ol>
  <li>确保平板 WiFi 代理设为: <b>192.168.1.102:8890</b></li>
  <li>打开浏览器访问 http://mitm.it/，应显示成功页面</li>
  <li>打开闲鱼 App 正常使用</li>
</ol>
</body>
</html>'''
            self.wfile.write(html.encode('utf-8'))
    
    def log_message(self, format, *args):
        print(f'[HTTP] {args[0]} {args[1]} {args[2]}')


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # Check cert file
    if not os.path.exists(CERT_FILE):
        print(f'❌ 未找到证书文件: {CERT_FILE}')
        print(f'   请先运行: testCode/find_mitm_cert.py')
        return
    
    # Start server
    server = http.server.HTTPServer(('0.0.0.0', PORT), CertHandler)
    print(f'✅ 证书下载服务已启动')
    print(f'   地址: http://192.168.1.102:{PORT}/')
    print(f'   平板浏览器打开后即可下载证书')
    print()
    print('按 Ctrl+C 停止')
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n服务已停止')
        server.server_close()


if __name__ == '__main__':
    main()
