/**
 * 最终尝试：从Chrome取完整cookie（含x5sec），直接调用pc.detail
 * 如果这次还不行，那就是 x5sec 真没法绕过
 */
import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import crypto from 'crypto';
import { URLSearchParams } from 'url';

const CDP_PORT = 9222;
const APP_KEY = '34839810';
const ITEM_ID = process.argv[2] || '1061901376412';

async function main() {
  // 1. 从Chrome获取所有cookie
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json`));
  const page = targets.find(t => (t.url || '').includes('goofish.com') && !t.url.includes('g.alicdn'));
  if (!page) { console.log('No goofish page'); process.exit(1); }
  
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 1; const p = new Map();
  ws.on('message', (d) => { try { const m = JSON.parse(d.toString()); if (m.id) { const h = p.get(m.id); if (h) { clearTimeout(h.t); p.delete(m.id); h.r(m); } } } catch(e) {} });
  const s = (m, par) => new Promise(r => { const i = id++; p.set(i, { r, t: setTimeout(() => { p.delete(i); r({}); }, 8000) }); ws.send(JSON.stringify({ id: i, method: m, params: par })); });
  await s('Network.enable'); await sleep(300);
  const ck = await s('Network.getAllCookies'); ws.close();
  
  const allCookies = ck.result?.cookies || [];
  
  // 2. 构建完整的cookie字符串（所有域名，不筛选）
  const cookieStr = allCookies
    .filter(c => !c.domain.includes('google') && !c.domain.includes('youtube'))
    .map(c => `${c.name}=${c.value}`).join('; ');
  
  const tkCookie = allCookies.find(c => c.name === '_m_h5_tk');
  const token = tkCookie ? tkCookie.value.split('_')[0] : '';
  const x5secCookie = allCookies.find(c => c.name === 'x5sec');
  
  console.log('Cookies total:', allCookies.length);
  console.log('Token:', token ? token.slice(0, 15) + '...' : 'NONE');
  console.log('x5sec:', x5secCookie ? '✅ found' : '❌ not found');
  console.log('Cookie str length:', cookieStr.length, 'chars');
  
  // 3. 如果cookie太长，精简到关键cookies
  const keyNames = ['_m_h5_tk', '_m_h5_tk_enc', 'x5sec', '_tb_token_', 'cookie2', 't', 'cna', 'tracknick', 'unb', 'sgcookie', 'tfstk', 'isg', 'l', 'csg', 'xlly_s'];
  const keyCookies = allCookies.filter(c => keyNames.includes(c.name));
  const finalCookieStr = keyCookies.map(c => `${c.name}=${c.value}`).join('; ');
  
  console.log('Key cookies:', keyCookies.length);
  console.log('Final cookie length:', finalCookieStr.length, 'chars');
  
  // 4. 调用 pc.detail
  const ts = Date.now();
  const data = { id: ITEM_ID, returnItemDO: true, needSellerDO: true };
  const dataStr = JSON.stringify(data);
  const sign = crypto.createHash('md5').update(`${token}&${ts}&${APP_KEY}&${dataStr}`).digest('hex');
  
  const params = {
    jsv: '2.7.2', appKey: APP_KEY, t: String(ts), sign, v: '1.0',
    type: 'originaljson', api: 'mtop.taobao.idle.pc.detail', dataType: 'json',
    timeout: '20000', accountSite: 'xianyu', sessionOption: 'AutoLoginOnly',
    spm_cnt: 'a21ybx.item.0.0',
  };
  
  const url = `https://h5api.m.goofish.com/h5/mtop.taobao.idle.pc.detail/1.0/?${new URLSearchParams(params)}`;
  
  console.log('\nCalling pc.detail...');
  
  const result = await new Promise((resolve, reject) => {
    const bodyData = `data=${encodeURIComponent(dataStr)}`;
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Cookie': finalCookieStr,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyData),
        'Origin': 'https://www.goofish.com',
        'Referer': 'https://www.goofish.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
    }, (res) => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const m = body.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
          resolve(m ? JSON.parse(m[1]) : JSON.parse(body));
        } catch(e) {
          resolve({ raw: body.slice(0, 300) });
        }
      });
    });
    req.on('error', reject);
    req.write(bodyData); req.end();
  });
  
  const ret = result.ret?.[0] || result.raw || '?';
  console.log('Response:', ret.slice(0, 80));
  
  if (ret.startsWith('SUCCESS')) {
    const item = result.data?.itemDO || result.data?.item || {};
    console.log('\n✅ SUCCESS!');
    console.log('  Title:', item.title);
    console.log('  Browse:', item.browseCnt);
    console.log('  Wants:', item.wantCnt);
    console.log('  Collect:', item.collectCnt);
    console.log('  Comments:', item.interactFavorCnt);
    console.log('  Reviews:', item.evaluateCnt);
  } else if (result.data?.url) {
    console.log('  x5sec redirect URL found (needs browser)');
  }
  
  process.exit(0);
}

function httpGet(url) { return new Promise(r => { http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error(e); process.exit(1); });
