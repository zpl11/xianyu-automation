import http from 'http';
import WebSocket from 'ws';

const CDP_PORT = 9222;
function httpGet(url) { return new Promise(r => { const req = http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }); req.on('error', () => r('')); req.setTimeout(5000, () => { req.destroy(); r(''); }); }); }

(async () => {
  const targets = JSON.parse(await httpGet('http://127.0.0.1:'+CDP_PORT+'/json'));
  const t = targets.find(t => (t.url || '').includes('goofish.com') && !t.url.includes('g.alicdn') && !t.url.includes('xdomain'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => { ws.on('open', r); ws.on('error', r); setTimeout(r, 3000); });
  let id = 1; const p = new Map();
  ws.on('message', d => { try { const m = JSON.parse(d.toString()); if (m.id) { const h = p.get(m.id); if (h) h.r(m); } } catch(e) {} });
  const s = (m, par) => new Promise(r => { const i = id++; p.set(i, { r }); ws.send(JSON.stringify({ id: i, method: m, params: par })); });
  await s('Network.enable');
  const ck = await s('Network.getAllCookies'); ws.close();
  const all = ck.result?.cookies || [];
  const keep = all.filter(c => ['.goofish.com','.taobao.com','.tb.cn','h5api.m.goofish.com'].some(d => c.domain.includes(d)));
  
  const cookieStr = keep.map(c => c.name + '=' + c.value).join('; ');
  console.log('Total keep cookies length:', cookieStr.length);
  const largeCookies = keep.filter(c => c.value.length > 500);
  console.log('Large cookies:', largeCookies.map(c => c.name));
})();
