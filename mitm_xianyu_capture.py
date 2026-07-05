"""
闲鱼 API 流量捕获 mitmproxy 插件
=================================
与 mitmproxy/mitmweb 配合使用，拦截平板端闲鱼App的所有API流量。

用法:
  1. 启动 mitmweb（带此插件）:
     mitmweb -s mitm_xianyu_capture.py
  
  2. 平板设置代理到本机:
     IP: 本机局域网IP (如 192.168.1.102)
     端口: 8080 (mitmproxy默认)
  
  3. 安装CA证书: 浏览器访问 mitm.it 下载安装
  
  4. 在平板上操作闲鱼App，流量将被记录到 captured_apis.jsonl

功能:
  - 拦截 h5api.m.goofish.com / api.m.goofish.com 的所有请求
  - 解析 MTOP JSONP 响应格式
  - 自动提取 5维数据 (浏览/想要/收藏/留言/评价)
  - 结构化保存到 JSONL 文件
  - 实时控制台输出
  - 统计 API 调用频次
"""

import json
import time
import os
import re
from datetime import datetime
from urllib.parse import urlparse, parse_qs

from mitmproxy import http

# ============================================================
#  配置
# ============================================================
TARGET_DOMAINS = [
    'h5api.m.goofish.com',
    'api.m.goofish.com',
    'h5api.m.taobao.com',
    'api.m.taobao.com',
]

OUTPUT_FILE = 'captured_apis.jsonl'
STATS_FILE = 'captured_stats.json'

# 关注的 API 名称关键词
INTERESTING_API_KEYWORDS = [
    'detail', 'search', 'item', 'shop', 'store',
    'user', 'seller', 'collect', 'favor',
    'comment', 'evaluate', 'review', 'rate',
    'publish', 'list', 'home', 'feed',
    'browse', 'want', 'recycle',
]

# ============================================================
#  工具函数
# ============================================================

def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] [{level}] {msg}')

def is_target_domain(host):
    """判断是否为闲鱼API域名"""
    return any(d in host for d in TARGET_DOMAINS)

def is_static_resource(url):
    """排除静态资源"""
    static_exts = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', 
                   '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot',
                   '.webp', '.mp4', '.webm']
    path = urlparse(url).path.lower()
    return any(path.endswith(ext) for ext in static_exts)

def parse_mtop_response(text):
    """解析 MTOP JSONP 响应"""
    if not text:
        return None
    
    # 尝试 JSONP 格式: mtopjsonp12345({...})
    jsonp_match = re.match(r'^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$', text, re.DOTALL)
    if jsonp_match:
        try:
            return json.loads(jsonp_match.group(1))
        except json.JSONDecodeError:
            pass
    
    # 尝试纯 JSON
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    
    return None

def extract_5dim_data(data):
    """从MTOP响应中提取5维数据"""
    result = {
        'browseCnt': None,
        'wantCnt': None,
        'collectCnt': None,
        'interactFavorCnt': None,
        'evaluateCnt': None,
    }
    
    if not data:
        return result
    
    # 详情页 API: data.itemDO
    if isinstance(data, dict):
        item = None
        if 'itemDO' in data:
            item = data['itemDO']
        elif 'item' in data and isinstance(data['item'], dict):
            item = data['item']
        
        if item:
            # 尝试各种可能的字段名
            for key in result:
                val = item.get(key, item.get({
                    'browseCnt': 'browseCnt viewCount views browseCount pageViewCount viewNum',
                    'wantCnt': 'wantCnt wantNum favorNum wantCount wantedCount',
                    'collectCnt': 'collectCnt collectNum favoriteNum starNum collectCount',
                    'interactFavorCnt': 'interactFavorCnt commentNum replyNum chatNum CommentCount interactCnt commentCount',
                    'evaluateCnt': 'evaluateCnt reviewNum rateNum evaluateNum reviewCount rateCount',
                }.get(key, key), None))
                if val is not None:
                    result[key] = val
        
        # 搜索列表 API: data.resultList[].data.item.main.clickParam.args
        if 'resultList' in data:
            items = data['resultList']
            # 从第一个商品提取可用的字段名参考
            if items and isinstance(items, list) and len(items) > 0:
                first = items[0]
                if isinstance(first, dict):
                    item_data = first.get('data', {})
                    if isinstance(item_data, dict):
                        item_main = item_data.get('item', {})
                        if isinstance(item_main, dict):
                            main = item_main.get('main', {})
                            if isinstance(main, dict):
                                cp = main.get('clickParam', {})
                                if isinstance(cp, dict):
                                    args = cp.get('args', {})
                                    if isinstance(args, dict):
                                        # 从搜索列表提取部分5维数据
                                        if 'wantNum' in args:
                                            try: result['wantCnt'] = int(args['wantNum'])
                                            except: pass
                                        if result['browseCnt'] is None and 'viewCount' in args:
                                            try: result['browseCnt'] = int(args['viewCount'])
                                            except: pass
                                        if 'collectNum' in args:
                                            try: result['collectCnt'] = int(args['collectNum'])
                                            except: pass
                                        if 'browseCnt' in args:
                                            try: result['browseCnt'] = int(args['browseCnt'])
                                            except: pass
    
    return result

def clean_data(data, max_depth=3):
    """清理数据，移除过大的二进制/无用字段，限制深度"""
    if max_depth <= 0:
        return '...'
    
    if isinstance(data, dict):
        cleaned = {}
        for k, v in data.items():
            k_lower = k.lower()
            # 跳过过大字段
            if k_lower in ('desc', 'description', 'content', 'html', 'raw'):
                cleaned[k] = f'<{len(str(v))} chars>'
            elif k_lower in ('image', 'images', 'pic', 'pics', 'picurl', 'picurls', 'img'):
                cleaned[k] = f'<{len(v) if isinstance(v, (list, str)) else 0} items>' if v else v
            else:
                cleaned[k] = clean_data(v, max_depth - 1)
        return cleaned
    elif isinstance(data, list):
        if len(data) > 20:
            return [clean_data(data[0], max_depth - 1), f'... +{len(data)-1} more']
        return [clean_data(item, max_depth - 1) for item in data]
    elif isinstance(data, str) and len(data) > 200:
        return data[:200] + '...'
    return data


# ============================================================
#  Mitmproxy Addon
# ============================================================

class XianyuAPICapture:
    """拦截并记录闲鱼API流量的mitmproxy插件"""
    
    def __init__(self):
        self.stats = {
            'start_time': datetime.now().isoformat(),
            'total_requests': 0,
            'api_calls': 0,
            'apis_found': {},       # api_name -> count
            'captured_items': 0,
            'data_fields_found': set(),
        }
        self.session_id = datetime.now().strftime('%Y%m%d_%H%M%S')
        self.output_file = f'captured_apis_{self.session_id}.jsonl'
        log(f'📁 输出文件: {self.output_file}')
    
    def _write_record(self, record):
        """写入一条捕获记录到JSONL文件"""
        with open(self.output_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
    
    def request(self, flow: http.HTTPFlow):
        """处理请求"""
        host = flow.request.pretty_host
        url = flow.request.pretty_url
        
        if not is_target_domain(host):
            return
        
        if is_static_resource(url):
            return
        
        self.stats['total_requests'] += 1
        
        # 记录请求基本信息
        record = {
            'type': 'request',
            'timestamp': datetime.now().isoformat(),
            'method': flow.request.method,
            'url': url,
            'host': host,
            'path': flow.request.path,
        }
        
        # 记录请求头（排除敏感信息）
        headers = dict(flow.request.headers)
        sensitive = ['cookie', 'authorization', 'token', 'set-cookie']
        for s in sensitive:
            if s in headers:
                headers[s] = f'<{len(headers[s])} chars>'
        record['headers'] = headers
        
        # 记录请求体
        if flow.request.content:
            content_type = flow.request.headers.get('content-type', '')
            if 'form' in content_type or 'json' in content_type:
                try:
                    text = flow.request.content.decode('utf-8', errors='replace')
                    # 解析表单数据
                    if 'form' in content_type:
                        from urllib.parse import parse_qs
                        parsed = parse_qs(text)
                        # 只保留结构，不保留值中的大块数据
                        for k, v in parsed.items():
                            if len(str(v)) > 500:
                                parsed[k] = f'<{len(str(v))} chars>'
                        record['request_body_parsed'] = parsed
                    else:
                        try:
                            record['request_body_json'] = json.loads(text)
                        except:
                            record['request_body_text'] = text[:500]
                except:
                    pass
        
        log(f'📤 {flow.request.method} {url}')
        self._write_record(record)
    
    def response(self, flow: http.HTTPFlow):
        """处理响应"""
        host = flow.request.pretty_host
        url = flow.request.pretty_url
        
        if not is_target_domain(host):
            return
        
        if is_static_resource(url):
            return
        
        self.stats['api_calls'] += 1
        
        # 获取响应文本
        resp_text = ''
        if flow.response.content:
            try:
                resp_text = flow.response.content.decode('utf-8', errors='replace')
            except:
                resp_text = str(flow.response.content[:200])
        
        # 解析MTOP响应
        resp_json = parse_mtop_response(resp_text)
        
        # 构建记录
        record = {
            'type': 'response',
            'timestamp': datetime.now().isoformat(),
            'method': flow.request.method,
            'url': url,
            'host': host,
            'path': flow.request.path,
            'status_code': flow.response.status_code,
        }
        
        # 提取 API 信息
        api_name = ''
        api_version = ''
        api_data = None
        
        if resp_json:
            api_name = resp_json.get('api', '')
            api_version = resp_json.get('v', '')
            api_data = resp_json.get('data', {})
            ret = resp_json.get('ret', [''])
            
            record['api_name'] = api_name
            record['api_version'] = api_version
            record['ret'] = ret
            
            # 统计API
            if api_name:
                self.stats['apis_found'][api_name] = self.stats['apis_found'].get(api_name, 0) + 1
            
            # 提取5维数据
            if api_data:
                dim5 = extract_5dim_data(api_data)
                has_data = any(v is not None for v in dim5.values())
                if has_data:
                    record['5dim_data'] = dim5
                    self.stats['captured_items'] += 1
                    
                    # 记录发现的字段
                    for k, v in dim5.items():
                        if v is not None:
                            self.stats['data_fields_found'].add(k)
                    
                    # 提取额外有用的信息
                    item_info = {}
                    if isinstance(api_data, dict):
                        item_do = api_data.get('itemDO', api_data.get('item', {}))
                        if isinstance(item_do, dict):
                            item_info = {
                                'itemId': item_do.get('itemId', ''),
                                'title': (item_do.get('title', '') or '')[:60],
                                'price': item_do.get('soldPrice', item_do.get('minPrice', '')),
                                'sellerName': api_data.get('sellerDO', {}).get('nick', ''),
                                'sellerId': api_data.get('sellerDO', {}).get('sellerId', ''),
                            }
                        # 搜索列表
                        if 'resultList' in api_data:
                            items = api_data['resultList']
                            item_info['search_result_count'] = len(items) if isinstance(items, list) else 0
                    
                    record['item_info'] = item_info
            
            # 保存清理后的数据用于分析
            record['data_cleaned'] = clean_data(api_data)
        
        # 打印摘要
        if api_name:
            dim5_str = ''
            if '5dim_data' in record:
                d = record['5dim_data']
                parts = []
                if d.get('browseCnt') is not None: parts.append(f'👁浏览:{d["browseCnt"]}')
                if d.get('wantCnt') is not None: parts.append(f'❤️想要:{d["wantCnt"]}')
                if d.get('collectCnt') is not None: parts.append(f'⭐收藏:{d["collectCnt"]}')
                if d.get('interactFavorCnt') is not None: parts.append(f'💬留言:{d["interactFavorCnt"]}')
                if d.get('evaluateCnt') is not None: parts.append(f'📝评价:{d["evaluateCnt"]}')
                dim5_str = ' | '.join(parts)
            
            item_title = record.get('item_info', {}).get('title', '')
            log(f'📥 [{api_name}] {item_title} {dim5_str}')
        else:
            log(f'📥 {flow.response.status_code} {url[:80]}')
        
        # 写入文件
        self._write_record(record)
        
        # 定期更新统计
        if self.stats['api_calls'] % 50 == 0:
            self._save_stats()
    
    def _save_stats(self):
        """保存统计数据"""
        stats_copy = dict(self.stats)
        stats_copy['data_fields_found'] = list(stats_copy['data_fields_found'])
        # 按调用次数排序API
        sorted_apis = sorted(stats_copy['apis_found'].items(), key=lambda x: -x[1])
        stats_copy['apis_found'] = dict(sorted_apis[:50])
        
        with open(STATS_FILE, 'w', encoding='utf-8') as f:
            json.dump(stats_copy, f, ensure_ascii=False, indent=2)
    
    def done(self):
        """插件结束时保存统计"""
        self._save_stats()
        log(f'=' * 50)
        log(f'📊 捕获统计:')
        log(f'   总请求: {self.stats["total_requests"]}')
        log(f'   API调用: {self.stats["api_calls"]}')
        log(f'   含5维数据的商品: {self.stats["captured_items"]}')
        log(f'   发现API数: {len(self.stats["apis_found"])}')
        log(f'   输出文件: {self.output_file}')
        
        if self.stats['apis_found']:
            log(f'\n📋 发现的API列表 (按调用次数排序):')
            sorted_apis = sorted(self.stats['apis_found'].items(), key=lambda x: -x[1])
            for name, count in sorted_apis[:30]:
                log(f'   {name:60s} x{count}')
        
        if self.stats['data_fields_found']:
            log(f'\n📋 发现的数据字段:')
            for field in sorted(self.stats['data_fields_found']):
                log(f'   - {field}')
        log(f'=' * 50)


# 注册插件
addons = [
    XianyuAPICapture()
]


if __name__ == '__main__':
    # 独立测试模式
    print("=" * 50)
    print("  闲鱼 API 流量捕获插件")
    print("=" * 50)
    print()
    print("请通过 mitmproxy 加载此插件:")
    print("  mitmweb -s mitm_xianyu_capture.py")
    print("  mitmdump -s mitm_xianyu_capture.py")
    print()
    print("插件配置:")
    print(f"  目标域名: {', '.join(TARGET_DOMAINS)}")
    print(f"  输出文件: {OUTPUT_FILE}")
    print(f"  统计文件: {STATS_FILE}")
