import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import crypto from 'crypto';
import { URLSearchParams } from 'url';

const CDP_PORT = 9222;
const APP_KEY = '34839810';
let _session = { cookies: '', token: '', valid: false };

function httpGet(url) { return new Promise(r => { 
  const req = http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); });
  req.on('error', () => r(''));
  req.setTimeout(5000, () => { req.destroy(); r(''); });
}); }

async function refreshSession() {
  const targets = JSON.parse(await httpGet('http://127.0.0.1:'+CDP_PORT+'/json'));
  const t = targets.find(t => (t.url || '').includes('goofish.com') && !t.url.includes('g.alicdn') && !t.url.includes('xdomain'));
  if (!t) return false;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => { ws.on('open', r); ws.on('error', r); setTimeout(r, 3000); });
  if (ws.readyState !== 1) return false;
  let id = 1; const p = new Map();
  ws.on('message', d => { try { const m = JSON.parse(d.toString()); if (m.id) { const h = p.get(m.id); if (h) { clearTimeout(h.t); p.delete(m.id); h.r(m); } } } catch(e) {} });
  const s = (m, par) => new Promise(r => { const i = id++; p.set(i, { r, t: setTimeout(() => { p.delete(i); r({}); }, 8000) }); ws.send(JSON.stringify({ id: i, method: m, params: par })); });
  await s('Network.enable');
  const ck = await s('Network.getAllCookies'); ws.close();
  const all = ck.result?.cookies || [];
  const tk = all.find(c => c.name === '_m_h5_tk');
  _session = { cookies: all.map(c => c.name + '=' + c.value).join('; '), token: tk ? tk.value.split('_')[0] : '', valid: !!tk };
  return _session.valid;
}

async function callMTOP(apiName, data) {
  const ts = Date.now();
  const dataStr = JSON.stringify(data);
  const sign = crypto.createHash('md5').update(_session.token+'&'+ts+'&'+APP_KEY+'&'+dataStr).digest('hex');
  const params = { jsv: '2.7.2', appKey: APP_KEY, t: String(ts), sign, v: '1.0', type: 'originaljson', api: 'mtop.'+apiName, dataType: 'json', timeout: '20000', accountSite: 'xianyu', sessionOption: 'AutoLoginOnly' };
  const url = 'https://h5api.m.goofish.com/h5/mtop.'+apiName+'/1.0/?' + new URLSearchParams(params);
  
  return new Promise((resolve, reject) => {
    const bd = 'data='+encodeURIComponent(dataStr);
    const req = https.request(url, { method: 'POST', headers: { 'Cookie': _session.cookies, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(bd), 'Origin': 'https://www.goofish.com', 'Referer': 'https://www.goofish.com/', 'User-Agent': 'Mozilla/5.0' }}, res => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => { 
        console.log('Response:', body.slice(0, 200));
        resolve();
      });
    }); req.on('error', reject); req.write(bd); req.end();
  });
}

(async () => {
  console.log('Refreshing session...');
  await refreshSession();
  console.log('Session valid:', _session.valid);
  console.log('Calling MTOP...');
  await callMTOP('idle.web.xyh.item.list', { needGroupInfo: true, pageNumber: 1, userId: '2222621138424', pageSize: 20 });
})();
