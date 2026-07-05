"""
闲鱼App API 抓包工具 - MITM代理
使用Python标准库 + cryptography 实现中间人抓包
"""
import socket
import ssl
import threading
import json
import logging
import os
import select
import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

PROXY_HOST = '0.0.0.0'
PROXY_PORT = 8888
LOCAL_IP = '192.168.1.102'
CERT_FILE = 'mitm_cert.pem'
KEY_FILE = 'mitm_key.pem'
TARGET_DOMAINS = ['h5api.m.goofish.com', 'h5api.m.taobao.com', 'api.m.goofish.com', 'mtop']

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(message)s', datefmt='%H:%M:%S')
log = logging.getLogger('proxy')

ca_key = None
ca_cert = None

def load_or_generate_ca():
    global ca_key, ca_cert
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        with open(KEY_FILE, 'rb') as f:
            ca_key = serialization.load_pem_private_key(f.read(), password=None)
        with open(CERT_FILE, 'rb') as f:
            ca_cert = x509.load_pem_x509_certificate(f.read())
        log.info('✅ 已加载CA证书')
        return
    
    log.info('生成CA证书...')
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_cert = x509.CertificateBuilder().subject_name(
        x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Xianyu MITM CA')])
    ).issuer_name(
        x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Xianyu MITM CA')])
    ).public_key(ca_key.public_key()).serial_number(x509.random_serial_number()
    ).not_valid_before(datetime.datetime.utcnow()
    ).not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650)
    ).add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True
    ).sign(ca_key, hashes.SHA256())
    
    with open(KEY_FILE, 'wb') as f:
        f.write(ca_key.private_bytes(serialization.Encoding.PEM, 
            serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
    with open(CERT_FILE, 'wb') as f:
        f.write(ca_cert.public_bytes(serialization.Encoding.PEM))
    log.info('✅ CA证书已生成')

def gen_cert_for_domain(domain):
    """为域名生成证书"""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    cert = x509.CertificateBuilder().subject_name(
        x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, domain)])
    ).issuer_name(ca_cert.subject
    ).public_key(key.public_key()).serial_number(x509.random_serial_number()
    ).not_valid_before(datetime.datetime.utcnow()
    ).not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=365)
    ).add_extension(x509.SubjectAlternativeName([x509.DNSName(domain)]), critical=False
    ).sign(ca_key, hashes.SHA256())
    
    key_pem = key.private_bytes(serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption())
    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    return key_pem, cert_pem

class MITMProxy:
    def __init__(self):
        self.captured = []
        self.cert_cache = {}
    
    def get_cert(self, domain):
        if domain not in self.cert_cache:
            self.cert_cache[domain] = gen_cert_for_domain(domain)
        return self.cert_cache[domain]
    
    def start(self):
        load_or_generate_ca()
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((PROXY_HOST, PROXY_PORT))
        server.listen(200)
        
        log.info(f'')
        log.info(f'🚀 MITM代理启动: {LOCAL_IP}:{PROXY_PORT}')
        log.info(f'')
        log.info(f'📋 操作步骤:')
        log.info(f'  1. 平板设置WiFi代理: IP={LOCAL_IP} 端口={PROXY_PORT}')
        log.info(f'  2. 在平板浏览器打开: http://{LOCAL_IP}:{PROXY_PORT}/cert')
        log.info(f'  3. 下载并安装CA证书 (设置→安全→安装证书→CA证书)')
        log.info(f'  4. 打开闲鱼App操作')
        log.info(f'')
        
        cert_server = HTTPServer(('', PROXY_PORT + 1), CertHandler)
        threading.Thread(target=cert_server.serve_forever, daemon=True).start()
        
        while True:
            try:
                client, addr = server.accept()
                threading.Thread(target=self.handle, args=(client,), daemon=True).start()
            except:
                break
    
    def handle(self, client):
        try:
            data = client.recv(4096)
            if not data: return
            first = data.split(b'\r\n')[0].decode('utf-8', errors='replace')
            
            if first.startswith('CONNECT'):
                target = first.split(' ')[1]
                host = target.split(':')[0]
                port = int(target.split(':')[1]) if ':' in target else 443
                
                client.send(b'HTTP/1.1 200 OK\r\n\r\n')
                
                is_target = any(d in host for d in TARGET_DOMAINS)
                if is_target:
                    self.mitm_connect(client, host, port)
                else:
                    self.passthrough(client, host, port)
            else:
                self.handle_http(client, data)
        except:
            pass
        finally:
            try: client.close()
            except: pass
    
    def passthrough(self, client, host, port):
        try:
            target = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            target.settimeout(30)
            target.connect((host, port))
            s = [client, target]
            while s:
                r, _, _ = select.select(s, [], [], 30)
                if not r: break
                for sock in r:
                    d = sock.recv(4096)
                    if not d: s.remove(sock); sock.close(); continue
                    (target if sock is client else client).send(d)
        except:
            pass
        finally:
            try: target.close()
            except: pass
    
    def mitm_connect(self, client, host, port):
        """MITM抓取API请求"""
        try:
            # 生成域名证书
            key_pem, cert_pem = self.get_cert(host)
            
            # 写入临时文件供ssl使用
            with open('_tmp_key.pem', 'wb') as f: f.write(key_pem)
            with open('_tmp_cert.pem', 'wb') as f: f.write(cert_pem)
            
            # 与客户端建立TLS
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain('_tmp_cert.pem', '_tmp_key.pem')
            client_tls = ctx.wrap_socket(client, server_side=True)
        except:
            return
        
        try:
            # 读取客户端请求
            data = client_tls.recv(32768)
            if not data: return
            
            req_text = data.decode('utf-8', errors='replace')
            first_line = req_text.split('\r\n')[0]
            parts = first_line.split(' ')
            if len(parts) < 3: return
            method = parts[0]
            path = parts[1]
            
            # 解析请求体
            body = ''
            if '\r\n\r\n' in req_text:
                body = req_text.split('\r\n\r\n', 1)[1]
            
            # 连接到真实服务器
            target = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            target.settimeout(15)
            target.connect((host, port))
            target_ssl = ssl.wrap_socket(target, server_side=False)
            target_ssl.sendall(data)
            
            # 读取响应
            resp = b''
            while True:
                try:
                    chunk = target_ssl.recv(32768)
                    if not chunk: break
                    resp += chunk
                except: break
            
            # 记录
            self.record(host, method, path, body, resp)
            
            # 返回给客户端
            if resp:
                client_tls.sendall(resp)
            
            target_ssl.close()
            client_tls.close()
        except:
            pass
    
    def record(self, host, method, path, req_body, resp_data):
        ts = datetime.datetime.now().strftime('%H:%M:%S')
        api_path = path.split('?')[0]
        
        # 解析MTOP响应
        resp_text = ''
        if b'\r\n\r\n' in resp_data:
            resp_text = resp_data.split(b'\r\n\r\n', 1)[1].decode('utf-8', errors='replace')
        
        resp_json = None
        if resp_text.startswith('mtopjsonp'):
            try:
                j = resp_text[resp_text.index('(')+1:resp_text.rindex(')')]
                resp_json = json.loads(j)
            except: pass
        else:
            try: resp_json = json.loads(resp_text)
            except: pass
        
        api = resp_json.get('api', '') if resp_json else ''
        
        log.info(f'\n📡 [{ts}] {method} {api_path}')
        
        if req_body:
            try:
                bj = json.loads(req_body) if req_body.startswith('{') else None
                if bj: log.info(f'  请求: {json.dumps(bj, ensure_ascii=False)[:300]}')
            except:
                log.info(f'  请求体: {req_body[:200]}')
        
        if resp_json:
            ret = resp_json.get('ret', [''])[0]
            log.info(f'  API: {api}')
            log.info(f'  状态: {ret}')
            
            data = resp_json.get('data', {})
            if isinstance(data, dict):
                # 详情API
                if 'itemDO' in data:
                    item = data['itemDO']
                    log.info(f'  📊 商品详情:')
                    log.info(f'     标题: {(item.get("title","") or "")[:40]}')
                    log.info(f'     价格: {item.get("soldPrice","")}')
                    log.info(f'     👁浏览: {item.get("browseCnt",0)}')
                    log.info(f'     ❤️想要: {item.get("wantCnt",0)}')
                    log.info(f'     ⭐收藏: {item.get("collectCnt",0)}')
                    # 检查是否有评价/留言
                    if 'interactFavorCnt' in item:
                        log.info(f'     💬互动: {item.get("interactFavorCnt",0)}')
                    # 保存完整数据
                    self.captured.append({
                        'type': 'detail',
                        'api': api,
                        'itemId': item.get('itemId', ''),
                        'title': item.get('title', ''),
                        'browseCnt': item.get('browseCnt', 0),
                        'wantCnt': item.get('wantCnt', 0),
                        'collectCnt': item.get('collectCnt', 0),
                        'interactFavorCnt': item.get('interactFavorCnt', 0),
                    })
                
                # 搜索列表API  
                if 'resultList' in data:
                    items = data['resultList']
                    log.info(f'  商品列表: {len(items)} 个')
                    if items:
                        args = items[0].get('data',{}).get('item',{}).get('main',{}).get('clickParam',{}).get('args',{})
                        log.info(f'  样例: want={args.get("wantNum","?")} price={args.get("price","?")}')
                
                # 查找其他商品相关字段
                for key in data:
                    if 'comment' in key.lower() or 'review' in key.lower() or 'evaluate' in key.lower():
                        log.info(f'  📝 {key}: {data[key]}')
                
            # 保存
            self.captured.append({'type': 'api', 'api': api, 'path': api_path, 'time': ts})
        
        log.info(f'  {"-"*40}')

class CertHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/cert':
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-x509-ca-cert')
            self.send_header('Content-Disposition', 'attachment')
            self.end_headers()
            with open(CERT_FILE, 'rb') as f:
                self.wfile.write(f.read())
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html;charset=utf-8')
            self.end_headers()
            self.wfile.write(f'''
                <html><body>
                <h3>闲鱼API抓包 - 证书安装</h3>
                <p><a href="/cert">📥 下载CA证书</a></p>
                <p>安装: 设置→安全→加密与凭据→安装证书→CA证书</p>
                <p>代理IP: {LOCAL_IP}:{PROXY_PORT}</p>
                </body></html>
            '''.encode())

if __name__ == '__main__':
    print('\n' + '=' * 50)
    print('  闲鱼App API 抓包工具')
    print('=' * 50)
    MITMProxy().start()
