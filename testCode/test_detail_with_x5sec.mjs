/**
 * 测试带上 x5sec cookie 调用 detail API
 */
import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import crypto from 'crypto';
import { URLSearchParams } from 'url';

const CDP_PORT = 9222;
const APP_KEY = '34839810';

async function main() {
  // 获取cookie
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json`));
  const t = targets.find(t => (t.url || '').includes('goofish.com'));
  const ws = await wsConnect(t.webSocketDebuggerUrl);
  await wsSend(ws, 'Network.enable');
  await sleep(300);
  const ck = await wsSend(ws, 'Network.getAllCookies');
  ws.close();
  
  const all = ck.result?.cookies || [];
  
  // 按域名分组，手动构建cookie字符串，确保包含关键cookie
  const cookieGroups = {
    goofish: all.filter(c => c.domain === '.goofish.com'),
    h5api: all.filter(c => c.domain === 'h5api.m.goofish.com'),
    passport: all.filter(c => c.domain === 'passport.goofish.com'),
    taobao: all.filter(c => c.domain === '.taobao.com'),
  };
  
  // 提取关键token
  const tkCookie = all.find(c => c.name === '_m_h5_tk');
  const token = tkCookie ? tkCookie.value.split('_')[0] : '';
  const x5secCookie = all.find(c => c.name === 'x5sec');
  const tbToken = all.find(c => c.name === '_tb_token_');
  const xsrfToken = all.find(c => c.name === 'XSRF-TOKEN');
  
  console.log('x5sec cookie:', x5secCookie ? x5secCookie.value.slice(0, 60) + '...' : '无');
  console.log('_tb_token_:', tbToken ? tbToken.value : '无');
  console.log('XSRF-TOKEN:', xsrfToken ? xsrfToken.value.slice(0, 30) + '...' : '无');
  console.log('token:', token.slice(0, 15) + '...');
  console.log();
  
  // 构建不同组合的cookie字符串进行测试
  const cookieCombos = [
    { name: '仅goofish域名', cookies: cookieGroups.goofish },
    { name: 'goofish + h5api(含x5sec)', cookies: [...cookieGroups.goofish, ...cookieGroups.h5api] },
    { name: '所有闲鱼cookie', cookies: [...cookieGroups.goofish, ...cookieGroups.h5api, ...cookieGroups.passport, ...cookieGroups.taobao] },
  ];
  
  const itemId = '1061901376412';
  
  for (const combo of cookieCombos) {
    const cookieStr = combo.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    const ts = Date.now();
    const data = { id: itemId, returnItemDO: true, needSellerDO: true };
    const dataStr = JSON.stringify(data);
    const sign = crypto.createHash('md5').update(`${token}&${ts}&${APP_KEY}&${dataStr}`).digest('hex');
    
    const params = new URLSearchParams({
      jsv: '2.7.2', appKey: APP_KEY, t: String(ts), sign, v: '1.0',
      type: 'originaljson', api: 'mtop.taobao.idle.pc.detail',
      dataType: 'json', timeout: '20000', accountSite: 'xianyu',
      sessionOption: 'AutoLoginOnly', spm_cnt: 'a21ybx.item.0.0',
    });
    
    const url = `https://h5api.m.goofish.com/h5/mtop.taobao.idle.pc.detail/1.0/?${params}`;
    
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
          let b = ''; res.on('data', c => b += c);
          res.on('end', () => {
            const m = b.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
            resolve(m ? JSON.parse(m[1]) : { raw: b.slice(0, 300) });
          });
        });
        req.on('error', reject);
        req.write(`data=${encodeURIComponent(dataStr)}`); req.end();
      });
      
      const ret = result.ret ? result.ret[0] : '?';
      const item = result.data?.itemDO || {};
      const title = item.title || '';
      const browse = item.browseCnt || 0;
      const want = item.wantCnt || 0;
      const sellerId = result.data?.sellerDO?.sellerId || '';
      
      console.log(`[${combo.name.padEnd(20)}] ${ret.slice(0, 50).padEnd(52)} title=${(title || '').slice(0, 20).padEnd(20)} browse=${browse} want=${want} sellerId=${sellerId}`);
      
      if (!ret.startsWith('SUCCESS') && result.data?.url) {
        // 解码x5secdata参数
        const url2 = result.data.url || '';
        const x5match = url2.match(/x5secdata=([^&]+)/);
        if (x5match) {
          console.log(`  x5secdata返回: ${x5match[1].slice(0, 40)}...`);
          console.log(`  x5sec请求的: ${(x5secCookie?.value || '').slice(0, 40)}...`);
          console.log(`  是否匹配: ${x5match[1].includes(x5secCookie?.value?.slice(0, 20) || '')}`);
        }
      }
    } catch(e) {
      console.log(`[${combo.name.padEnd(20)}] ERROR: ${e.message}`);
    }
    
    await sleep(500);
  }
  
  process.exit(0);
}

function httpGet(url) { return new Promise(r => { http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }); }); }
function wsConnect(url) { return new Promise(r => { const w = new WebSocket(url); w.on('open', () => r(w)); }); }
function wsSend(ws, method, params = {}) { return new Promise(r => { const id = Date.now() % 100000; const handler = (data) => { const msg = JSON.parse(data.toString()); if (msg.id === id) { ws.removeListener('message', handler); r(msg); } }; ws.on('message', handler); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { ws.removeListener('message', handler); r({}); }, 8000); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => console.error(e));
