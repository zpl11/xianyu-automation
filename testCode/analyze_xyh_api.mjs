/**
 * 分析 xyh.item.list API 的响应结构
 */
import WebSocket from 'ws';
import http from 'http';

async function main() {
  // Create page
  const pageInfo = await new Promise((resolve, reject) => {
    const req = http.request('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
  
  const ws = await new Promise((resolve) => {
    const w = new WebSocket(pageInfo.webSocketDebuggerUrl);
    w.on('open', () => resolve(w));
  });
  
  let cmdId = 1;
  const pending = new Map();
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id !== undefined) {
      const h = pending.get(msg.id);
      if (h) { clearTimeout(h.t); pending.delete(msg.id); h.r(msg); }
    } else if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response?.url || '';
      if (url.includes('h5api.m.goofish.com/h5/mtop.')) {
        const apiName = url.match(/mtop\.[^/?]+/)?.[0] || '';
        const requestId = msg.params.requestId;
        
        setTimeout(async () => {
          const id2 = cmdId++;
          ws.send(JSON.stringify({ id: id2, method: 'Network.getResponseBody', params: { requestId } }));
          new Promise(r => pending.set(id2, { r, t: setTimeout(() => r({result:{}}), 3000) }));
        }, 200);
      }
    }
  });
  
  const send = (method, params) => new Promise(r => {
    const id = cmdId++;
    pending.set(id, { r, t: setTimeout(() => r({}), 10000) });
    ws.send(JSON.stringify({ id, method, params }));
  });
  
  // Enable domains
  await send('Page.enable');
  await send('Network.enable');
  
  // Navigate to personal page
  const userId = '4252893945';
  console.log(`导航到店铺页: ${userId}`);
  await send('Page.navigate', { url: `https://www.goofish.com/personal?userId=${userId}` });
  await new Promise(r => setTimeout(r, 6000));
  
  // Get response bodies that we saved
  console.log('\n等待API响应...');
  await new Promise(r => setTimeout(r, 5000));
  
  console.log('\n完成');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
