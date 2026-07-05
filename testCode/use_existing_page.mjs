/**
 * 利用 Chrome 中已有的闲鱼页面获取 5维数据
 * =========================================
 * 您的 Chrome 已经有一页闲鱼页面打开且已登录，
 * 这个页面已经通过了 x5sec 验证。
 * 
 * 我们只需要让这个页面导航到目标商品详情页，
 * 然后截获 pc.detail API 的响应。
 * 
 * 用户无感知：页面在后台导航，不弹出新窗口。
 */

import http from 'http';
import WebSocket from 'ws';

const CDP_PORT = 9222;

async function fetchDetail(itemId) {
  // 1. 找到已有的闲鱼页面
  const targets = JSON.parse(await new Promise(r => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => r(d));
    });
  }));
  
  const xianyuPage = targets.find(t => 
    (t.url || '').includes('goofish.com')
  );
  
  if (!xianyuPage) {
    console.log('❌ 未找到闲鱼页面，请先在 Chrome 中打开闲鱼');
    return null;
  }
  
  // 2. 连接到这个页面
  const ws = new WebSocket(xianyuPage.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  
  let cmdId = 1;
  const pending = new Map();
  let detailData = null;
  let apiRet = '';
  let currentUrl = '';
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id) {
      const h = pending.get(msg.id);
      if (h) { clearTimeout(h.t); pending.delete(msg.id); h.r(msg); }
    } else if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response?.url || '';
      if (url.includes('pc.detail') || url.includes('item.detail')) {
        const rid = msg.params.requestId;
        apiRet = msg.params.response?.status + '';
        setTimeout(async () => {
          try {
            const id2 = cmdId++;
            ws.send(JSON.stringify({ id: id2, method: 'Network.getResponseBody', params: { requestId: rid } }));
            const result = await new Promise(r => pending.set(id2, { r, t: setTimeout(() => r(null), 5000) }));
            if (!result?.result?.body) return;
            const text = result.result.body;
            const m = text.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
            const parsed = m ? JSON.parse(m[1]) : JSON.parse(text);
            const ret = (parsed.ret || [''])[0];
            
            if (ret.startsWith('SUCCESS')) {
              const data = parsed.data || {};
              const item = data.itemDO || data.item || {};
              const seller = data.sellerDO || {};
              if (item.itemId) {
                detailData = {
                  itemId: String(item.itemId),
                  title: (item.title || '').trim(),
                  price: item.soldPrice || item.minPrice || '',
                  views: parseInt(item.browseCnt || 0, 10),
                  wants: parseInt(item.wantCnt || 0, 10),
                  favorites: parseInt(item.collectCnt || 0, 10),
                  comments: parseInt(item.interactFavorCnt || 0, 10),
                  reviews: parseInt(item.evaluateCnt || 0, 10),
                  sellerName: seller.nick || '',
                };
                console.log('  ✅ API响应解析成功');
              }
            } else {
              console.log('  ⚠️ API返回: ' + ret.slice(0, 60));
            }
          } catch(e) {
            console.log('  ⚠️ 解析失败: ' + e.message);
          }
        }, 300);
      }
    }
  });
  
  const send = (m, p) => new Promise(r => {
    const id = cmdId++; const t = setTimeout(() => { pending.delete(id); r(null); }, 25000);
    pending.set(id, { r, t }); ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  
  // 3. 启用网络监听
  await send('Network.enable');
  await send('Page.enable');
  
  // 4. 获取当前URL
  const urlResult = await send('Runtime.evaluate', { expression: 'window.location.href' });
  console.log('  当前页面: ' + (urlResult?.result?.value || '').slice(0, 80));
  
  // 5. 导航到目标商品详情页
  const targetUrl = `https://www.goofish.com/item/${itemId}`;
  console.log(`  导航到: ${targetUrl}`);
  console.log('  Chrome 自动处理 x5sec 验证...');
  
  await send('Page.navigate', { url: targetUrl });
  
  // 6. 等待页面加载和API响应
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (detailData) break;
    if (i % 3 === 2) process.stdout.write('.');
  }
  
  ws.close();
  
  return detailData;
}

async function main() {
  const itemId = process.argv[2] || '1061901376412';
  
  console.log('=' * 50);
  console.log('  利用已有Chrome页面获取5维数据');
  console.log('=' * 50);
  console.log(`  商品ID: ${itemId}\n`);
  
  const detail = await fetchDetail(itemId);
  
  if (detail) {
    console.log('\n✅ 获取成功!\n');
    console.log(`  标题: ${detail.title}`);
    console.log(`  价格: ¥${detail.price}`);
    console.log(`  👁 浏览: ${detail.views}`);
    console.log(`  ❤️ 想要: ${detail.wants}`);
    console.log(`  ⭐ 收藏: ${detail.favorites}`);
    console.log(`  💬 留言: ${detail.comments}`);
    console.log(`  📝 评价: ${detail.reviews}`);
    if (detail.sellerName) console.log(`  卖家: ${detail.sellerName}`);
  } else {
    console.log('\n❌ 获取失败');
    console.log('   请在 Chrome 的闲鱼页面中先手动打开一个商品详情页');
    console.log('   完成 x5sec 验证后，重新运行本命令');
  }
  
  process.exit(0);
}

main().catch(e => { console.error('错误:', e); process.exit(1); });
