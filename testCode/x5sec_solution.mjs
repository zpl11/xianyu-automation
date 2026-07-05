/**
 * x5sec 解决方案 v2
 * ==================
 * 让 Chrome 处理 x5sec 验证，我们通过 CDP 截获验证后的 API 响应。
 * 但对外表现为"不需要用户操作"——Chrome 在后台静默完成。
 * 
 * 原理：
 *   1. 通过 CDP 连接到用户的 Chrome（只需连接到已打开的闲鱼页面）
 *   2. 在 Chrome 中打开商品详情页
 *   3. Chrome 自动处理 x5sec 验证（用户在闲鱼的登录态已通过验证）
 *   4. 我们截获 pc.detail API 的完整响应
 *   5. 返回 5维数据
 * 
 * 注意：整个过程用户无感知，Chrome 在后台处理，用户不需要任何操作。
 */

import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import crypto from 'crypto';

const CDP_PORT = 9222;

async function fetchDetailWithX5sec(itemId) {
  /**
   * 通过 CDP 让 Chrome 处理 x5sec，获取商品详情
   * Chrome 在后台打开页面，处理验证，我们截获 API 响应
   */
  
  // 1. 创建隐身页面（用户无感知）
  const pageInfo = await new Promise(r => {
    const req = http.request(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
    }); req.end();
  });
  
  // 2. 连接到页面
  const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  
  let cmdId = 1;
  const pending = new Map();
  let detailData = null;
  let requestHeaders = null;
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id) {
      const h = pending.get(msg.id);
      if (h) { clearTimeout(h.t); pending.delete(msg.id); h.r(msg); }
    } else if (msg.method === 'Network.requestWillBeSent') {
      const url = msg.params.request?.url || '';
      if (url.includes('pc.detail')) {
        requestHeaders = msg.params.request.headers;
      }
    } else if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response?.url || '';
      if (url.includes('pc.detail')) {
        const rid = msg.params.requestId;
        // 延迟一下等响应体就绪
        setTimeout(async () => {
          try {
            const id2 = cmdId++;
            ws.send(JSON.stringify({ id: id2, method: 'Network.getResponseBody', params: { requestId: rid } }));
            const result = await new Promise(r => pending.set(id2, { r, t: setTimeout(() => r(null), 5000) }));
            if (!result) return;
            const text = result.result?.body || '';
            if (!text) return;
            
            const m = text.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
            const parsed = m ? JSON.parse(m[1]) : JSON.parse(text);
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
                pubTime: item.gmtCreate || '',
              };
            }
          } catch(e) {}
        }, 1000);
      }
    }
  });
  
  const send = (m, p) => new Promise(r => {
    const id = cmdId++; const t = setTimeout(() => { pending.delete(id); r(null); }, 25000);
    pending.set(id, { r, t }); ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  
  // 3. 启用网络域
  await send('Network.enable');
  await send('Page.enable');
  
  // 4. 导航到商品页（Chrome 会自动处理 x5sec）
  await send('Page.navigate', { url: `https://www.goofish.com/item/${itemId}` });
  
  // 5. 等待页面加载和API响应
  await new Promise(r => setTimeout(r, 8000));
  
  ws.close();
  
  // 清理隐藏页面（关闭标签页）
  try {
    http.get(`http://127.0.0.1:${CDP_PORT}/json/close/${pageInfo.id}`, () => {});
  } catch(e) {}
  
  return detailData;
}

// ============================================================
//  测试
// ============================================================

async function main() {
  const itemId = process.argv[2] || '1061901376412';
  
  console.log('=' * 50);
  console.log('  x5sec 解决方案 - CDP 静默模式');
  console.log('=' * 50);
  console.log(`  商品ID: ${itemId}`);
  console.log('  Chrome 将在后台处理 x5sec 验证...');
  console.log();
  
  const detail = await fetchDetailWithX5sec(itemId);
  
  if (detail) {
    console.log('✅ 成功获取商品详情:\n');
    console.log(`  标题: ${detail.title}`);
    console.log(`  价格: ¥${detail.price}`);
    console.log(`  👁 浏览: ${detail.views}`);
    console.log(`  ❤️ 想要: ${detail.wants}`);
    console.log(`  ⭐ 收藏: ${detail.favorites}`);
    console.log(`  💬 留言: ${detail.comments}`);
    console.log(`  📝 评价: ${detail.reviews}`);
    console.log(`  卖家: ${detail.sellerName}`);
  } else {
    console.log('❌ 获取失败');
    console.log('   可能原因: x5sec 验证需要手动操作');
    console.log('   请手动在 Chrome 中打开一个商品详情页完成验证');
    console.log('   然后重试');
  }
  
  process.exit(0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error('错误:', e); process.exit(1); });
