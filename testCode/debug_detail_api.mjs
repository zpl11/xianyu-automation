/**
 * 调试商品详情API
 * 分析为什么 pc.detail 返回空数据
 */
import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import crypto from 'crypto';
import { URLSearchParams } from 'url';

const CDP_PORT = 9222;
const APP_KEY = '34839810';

async function main() {
  // 1. 获取cookie
  const targets = await new Promise(r => {
    http.get('http://127.0.0.1:9222/json', res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
    });
  });
  const t = targets.find(t => (t.url || '').includes('goofish.com'));
  const ws = await new Promise(r => { const w = new WebSocket(t.webSocketDebuggerUrl); w.on('open', () => r(w)); });
  let id = 1; const p = new Map();
  ws.on('message', (d) => {
    try { const m = JSON.parse(d.toString()); if (m.id) { const h = p.get(m.id); if (h) { clearTimeout(h.t); p.delete(m.id); h.r(m); } } } catch(e) {}
  });
  const s = (m, par) => new Promise(r => { const i = id++; const t2 = setTimeout(() => { p.delete(i); r({}); }, 10000); p.set(i, { r, t: t2 }); ws.send(JSON.stringify({ id: i, method: m, params: par })); });
  await s('Network.enable'); await new Promise(r => setTimeout(r, 300));
  const ck = await s('Network.getAllCookies');
  const all = ck.result?.cookies || [];
  const keyDomains = ['.goofish.com', '.taobao.com', '.tmall.com', '.tb.cn', 'h5api.m.goofish.com'];
  const filtered = all.filter(c => keyDomains.some(d => c.domain.includes(d)));
  const cookieStr = filtered.map(c => c.name + '=' + c.value).join('; ');
  const tkCookie = all.find(c => c.name === '_m_h5_tk');
  const token = tkCookie ? tkCookie.value.split('_')[0] : '';
  ws.close();
  
  console.log('Token: ' + (token ? token.slice(0, 15) + '...' : '无'));
  console.log('Cookies: ' + filtered.length + ' 个, 总长: ' + cookieStr.length + ' 字符');
  console.log();
  
  // 2. 测试详情的两种不同请求体
  const testItems = [
    { id: '1061901376412', title: '店铺商品1' },
    { id: '1059354152213', title: '旧商品ID' },
    { id: '2217571424592', title: 'userId(非商品)' },
  ];
  
  const requestBodies = [
    { name: '基本请求', data: { id: '' } },
    { name: '带returnItemDO', data: { id: '', returnItemDO: true } },
    { name: '完整请求', data: { id: '', returnItemDO: true, needSellerDO: true } },
  ];
  
  for (const item of testItems) {
    console.log('---');
    console.log('商品: ' + item.title + ' (id=' + item.id + ')');
    
    for (const rb of requestBodies) {
      rb.data.id = item.id;
      const dataStr = JSON.stringify(rb.data);
      const ts = Date.now();
      const signStr = token + '&' + ts + '&' + APP_KEY + '&' + dataStr;
      const sign = crypto.createHash('md5').update(signStr).digest('hex');
      
      const params = new URLSearchParams({
        jsv: '2.7.2', appKey: APP_KEY, t: String(ts), sign, v: '1.0',
        type: 'originaljson', api: 'mtop.taobao.idle.pc.detail',
        dataType: 'json', timeout: '20000', accountSite: 'xianyu',
        sessionOption: 'AutoLoginOnly', spm_cnt: 'a21ybx.item.0.0',
      });
      
      const url = 'https://h5api.m.goofish.com/h5/mtop.taobao.idle.pc.detail/1.0/?' + params;
      
      try {
        const result = await new Promise((resolve, reject) => {
          const req = https.request(url, {
            method: 'POST',
            headers: {
              'Cookie': cookieStr,
              'Content-Type': 'application/x-www-form-urlencoded',
              'Origin': 'https://www.goofish.com', 'Referer': 'https://www.goofish.com/',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json',
            },
          }, (res) => {
            let b = ''; res.on('data', c => b += c); res.on('end', () => {
              const m = b.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
              resolve(m ? JSON.parse(m[1]) : { raw: b.slice(0, 300) });
            });
          });
          req.on('error', reject);
          req.write('data=' + encodeURIComponent(dataStr)); req.end();
        });
        
        const ret = result.ret ? result.ret[0] : '?';
        const itemDO = result.data?.itemDO;
        const title = itemDO?.title || '';
        const browse = itemDO?.browseCnt || 0;
        const seller = result.data?.sellerDO?.sellerId || '';
        console.log('  [' + rb.name.padEnd(10) + '] ret=' + ret.slice(0, 40) + ' title=' + (title || '').slice(0, 20) + ' browse=' + browse + ' sellerId=' + seller);
        
        if (!ret.startsWith('SUCCESS')) {
          console.log('    完整响应: ' + JSON.stringify(result).slice(0, 300));
        }
      } catch(e) {
        console.log('  [' + rb.name.padEnd(10) + '] ERROR: ' + e.message);
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
