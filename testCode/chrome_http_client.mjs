/**
 * 用 Chrome 做 HTTP 客户端（利用 CDP Fetch API）
 * Chrome 只作为网络传输层，不显示窗口，用户无感知。
 * 
 * 这样 x5sec 验证自动通过（Chrome 处理 cookie/TLS/指纹）
 * 但开发者只需要拿到响应数据
 */
import http from 'http';
import WebSocket from 'ws';

const CDP_PORT = 9222;

async function chromeFetch(url, method = 'GET', headers = {}, body = null) {
  /** 用 Chrome 的网络栈发送 HTTP 请求，返回响应体 */
  
  // 连接到一个不显眼的隐藏页面
  const pageInfo = await new Promise(r => {
    const req = http.request(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
    }); req.end();
  });
  
  const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  
  let cmdId = 1;
  const pending = new Map();
  let responseData = null;
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id) {
      const h = pending.get(msg.id);
      if (h) { clearTimeout(h.t); pending.delete(msg.id); h.r(msg); }
    } else if (msg.method === 'Fetch.requestPaused') {
      // 放行请求但捕获响应
      const reqId = msg.params.requestId;
      const url2 = msg.params.request.url;
      
      // 获取响应体
      ws.send(JSON.stringify({ id: cmdId++, method: 'Fetch.getResponseBody', params: { requestId: reqId } }));
      ws.send(JSON.stringify({ id: cmdId++, method: 'Fetch.continueRequest', params: { requestId: reqId } }));
    } else if (msg.method === 'Fetch.requestPaused') {
      // 放行
      ws.send(JSON.stringify({ id: cmdId++, method: 'Fetch.continueRequest', params: { requestId: msg.params.requestId } }));
    }
  });
  
  const send = (m, p) => new Promise(r => {
    const id = cmdId++; const t = setTimeout(() => { pending.delete(id); r(null); }, 30000);
    pending.set(id, { r, t }); ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  
  // 启用 Fetch 域
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] });
  
  // 导航到目标URL（这将通过Chrome的网络栈发送请求）
  await send('Page.navigate', { url });
  
  // 等待加载
  await new Promise(r => setTimeout(r, 8000));
  
  ws.close();
  
  // 清理页面
  try { http.get(`http://127.0.0.1:${CDP_PORT}/json/close/${pageInfo.id}`, () => {}); } catch(e) {}
  
  return responseData;
}

async function main() {
  console.log('用 Chrome 网络栈获取商品详情...\n');
  
  const url = 'https://h5api.m.goofish.com/h5/mtop.taobao.idle.pc.detail/1.0/';
  console.log('由于 Fetch API 需要更复杂的处理，让我们换一种更可靠的方式：\n');
  
  // 更可靠的方式：直接创建隐藏页面，导航到商品详情
  // Chrome 加载页面时会自动调用所有API，我们截获响应
  console.log('方案：创建隐藏页面 → 导航到商品页 → 截获API响应\n');
  
  // 创建隐藏页面
  const pageInfo = await new Promise(r => {
    const req = http.request(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
    }); req.end();
  });
  
  const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  
  let cmdId = 1;
  const pending = new Map();
  let detailFound = null;
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id) {
      const h = pending.get(msg.id);
      if (h) { clearTimeout(h.t); pending.delete(msg.id); h.r(msg); }
    } else if (msg.method === 'Network.responseReceived') {
      const respUrl = msg.params.response?.url || '';
      if (respUrl.includes('pc.detail') || respUrl.includes('item.detail')) {
        const rid = msg.params.requestId;
        setTimeout(async () => {
          try {
            const id2 = cmdId++;
            ws.send(JSON.stringify({ id: id2, method: 'Network.getResponseBody', params: { requestId: rid } }));
            const result = await new Promise(r => pending.set(id2, { r, t: setTimeout(() => r(null), 5000) }));
            if (!result?.result?.body) return;
            const text = result.result.body;
            const m = text.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
            const parsed = m ? JSON.parse(m[1]) : JSON.parse(text);
            const data = parsed.data || {};
            const item = data.itemDO || data.item || {};
            if (item.itemId) {
              detailFound = {
                itemId: String(item.itemId),
                title: (item.title || '').trim(),
                price: item.soldPrice || item.minPrice || '',
                views: parseInt(item.browseCnt || 0, 10),
                wants: parseInt(item.wantCnt || 0, 10),
                favorites: parseInt(item.collectCnt || 0, 10),
                comments: parseInt(item.interactFavorCnt || 0, 10),
                reviews: parseInt(item.evaluateCnt || 0, 10),
              };
            }
          } catch(e) {}
        }, 500);
      }
    }
  });
  
  const send = (m, p) => new Promise(r => {
    const id = cmdId++; const t = setTimeout(() => { pending.delete(id); r(null); }, 25000);
    pending.set(id, { r, t }); ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  
  await send('Network.enable');
  await send('Page.enable');
  
  const itemId = process.argv[2] || '1061901376412';
  console.log(`导航到商品: ${itemId}`);
  console.log('（Chrome 静默处理 x5sec 验证...）\n');
  
  await send('Page.navigate', { url: `https://www.goofish.com/item/${itemId}` });
  
  // 等待页面加载
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (detailFound) break;
  }
  
  ws.close();
  try { http.get(`http://127.0.0.1:${CDP_PORT}/json/close/${pageInfo.id}`, () => {}); } catch(e) {}
  
  if (detailFound) {
    console.log('✅ 获取成功!\n');
    console.log(`  标题: ${detailFound.title}`);
    console.log(`  价格: ¥${detailFound.price}`);
    console.log(`  👁 浏览: ${detailFound.views}`);
    console.log(`  ❤️ 想要: ${detailFound.wants}`);
    console.log(`  ⭐ 收藏: ${detailFound.favorites}`);
    console.log(`  💬 留言: ${detailFound.comments}`);
    console.log(`  📝 评价: ${detailFound.reviews}`);
  } else {
    console.log('❌ 未捕获到 API 响应');
    console.log('   可能需要先在 Chrome 中完成一次 x5sec 验证');
    console.log('   请手动在 Chrome 中打开一个商品详情页');
    console.log('   然后重试本命令');
  }
  
  process.exit(0);
}

main().catch(e => { console.error('错误:', e); process.exit(1); });
