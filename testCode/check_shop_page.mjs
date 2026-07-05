/**
 * 访问店铺页面并检查API响应
 */
import http from 'http';
import WebSocket from 'ws';

const USER_ID = process.argv[2] || '2217571424592';

async function main() {
  const pageInfo = await new Promise(r => {
    const req = http.request('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
    }); req.end();
  });
  
  const ws = await new Promise(r => { const w = new WebSocket(pageInfo.webSocketDebuggerUrl); w.on('open', () => r(w)); });
  let cmdId = 1;
  const pending = new Map();
  let capturedBodies = [];
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id) {
      const h = pending.get(msg.id);
      if (h) { clearTimeout(h.t); pending.delete(msg.id); h.r(msg); }
    } else if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response?.url || '';
      if (url.includes('h5api.m.goofish.com/h5/mtop.')) {
        const rid = msg.params.requestId;
        const apiMatch = url.match(/mtop\.[^/?]+/);
        const apiName = apiMatch ? apiMatch[0] : '?';
        setTimeout(async () => {
          try {
            const id2 = cmdId++;
            ws.send(JSON.stringify({ id: id2, method: 'Network.getResponseBody', params: { requestId: rid } }));
            const result = await new Promise(r => pending.set(id2, { r, t: setTimeout(() => r({result:{}}), 5000) }));
            if (result.result?.body) {
              capturedBodies.push({ apiName, body: result.result.body });
            }
          } catch(e) {}
        }, 100);
      }
    }
  });
  
  const send = (m, p) => new Promise(r => {
    const id = cmdId++;
    const t = setTimeout(() => { pending.delete(id); r({}); }, 15000);
    pending.set(id, { r, t });
    ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  
  await send('Network.enable');
  await send('Page.enable');
  
  console.log('访问店铺页: userId=' + USER_ID);
  await send('Page.navigate', { url: 'https://www.goofish.com/personal?userId=' + USER_ID });
  await new Promise(r => setTimeout(r, 8000));
  
  console.log('\n捕获的API响应:\n');
  
  for (const cb of capturedBodies) {
    const text = cb.body;
    let parsed;
    const m = text.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
    if (m) { try { parsed = JSON.parse(m[1]); } catch(e) {} }
    else { try { parsed = JSON.parse(text); } catch(e) {} }
    
    if (!parsed) continue;
    
    const api = parsed.api || cb.apiName;
    const ret = (parsed.ret || [''])[0];
    const data = parsed.data || {};
    const keys = Object.keys(data);
    
    console.log('=== ' + api + ' ===');
    console.log('  ret: ' + ret.slice(0, 80));
    console.log('  data keys: ' + JSON.stringify(keys.slice(0, 20)));
    
    if (api.includes('xyh.item.list')) {
      console.log('  totalCount: ' + data.totalCount);
      console.log('  cardList length: ' + (data.cardList ? data.cardList.length : 0));
      const items = data.cardList || [];
      items.forEach((c, i) => {
        const cd = c.cardData || {};
        console.log('  [' + (i+1) + '] id=' + cd.id + ' title=' + (cd.title || '?').slice(0, 30));
      });
    }
    
    if (api.includes('user.page.head')) {
      const bi = data.baseInfo || {};
      console.log('  sellerId: ' + (bi.sellerId || bi.userId || '?'));
      console.log('  nick: ' + (bi.nick || '?'));
      console.log('  itemCount: ' + (bi.itemCount || '?'));
      console.log('  baseInfo keys: ' + JSON.stringify(Object.keys(bi)));
    }
  }
  
  if (capturedBodies.length === 0) {
    console.log('没有捕获到API响应');
  }
  
  ws.close();
  process.exit(0);
}

main().catch(e => { console.error('错误:', e); process.exit(1); });
