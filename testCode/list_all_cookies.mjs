/**
 * 列出所有闲鱼相关cookie，查找x5sec相关的token
 */
import http from 'http';
import WebSocket from 'ws';

const CDP_PORT = 9222;

async function main() {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json`));
  const t = targets.find(t => (t.url || '').includes('goofish.com'));
  if (!t) { console.log('找不到闲鱼页面'); return; }
  
  const ws = await wsConnect(t.webSocketDebuggerUrl);
  await wsSend(ws, 'Network.enable');
  await sleep(300);
  const ck = await wsSend(ws, 'Network.getAllCookies');
  ws.close();
  
  const all = ck.result?.cookies || [];
  
  // 按域名分组
  const byDomain = {};
  for (const c of all) {
    if (!byDomain[c.domain]) byDomain[c.domain] = [];
    byDomain[c.domain].push(c);
  }
  
  console.log('所有Cookie (按域名):\n');
  for (const [domain, cookies] of Object.entries(byDomain).sort()) {
    if (!domain.includes('taobao') && !domain.includes('goofish') && !domain.includes('tb') && !domain.includes('tmall')) continue;
    console.log(`📍 ${domain}`);
    for (const c of cookies) {
      const marker = (c.name.includes('x5') || c.name.includes('sec') || c.name.includes('token') || c.name === '_m_h5_tk') ? ' ⬅️' : '';
      console.log(`   ${c.name} = ${c.value.slice(0, 50)}${c.value.length > 50 ? '...' : ''}${marker}`);
    }
    console.log();
  }
  
  // 查找x5sec相关
  const x5sec = all.filter(c => 
    c.name.toLowerCase().includes('x5') || 
    c.name.toLowerCase().includes('sec') || 
    c.name.toLowerCase().includes('token')
  );
  if (x5sec.length > 0) {
    console.log('\n🔑 安全相关Cookie:');
    for (const c of x5sec) {
      console.log(`  ${c.name} (${c.domain}): ${c.value.slice(0, 60)}`);
    }
  }
}

function httpGet(url) {
  return new Promise(r => {
    http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); });
  });
}
function wsConnect(url) {
  return new Promise(r => { const w = new WebSocket(url); w.on('open', () => r(w)); });
}
function wsSend(ws, method, params = {}) {
  return new Promise(r => {
    const id = Date.now() % 100000;
    const handler = (data) => { const msg = JSON.parse(data.toString()); if (msg.id === id) { ws.removeListener('message', handler); r(msg); } };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { ws.removeListener('message', handler); r({}); }, 10000);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => console.error(e));
