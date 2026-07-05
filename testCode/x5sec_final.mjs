/**
 * x5sec 最终方案
 * 
 * 在 Chrome 页面中调用已有的 MTOP 库来获取商品详情。
 * 页面的 MTOP 库会处理 x5sec/cookie/签名 等所有事情。
 * 
 * 我们只需要注入一段 JS，调用已有函数即可。
 */
import http from 'http';
import WebSocket from 'ws';

const CDP_PORT = 9222;

async function fetchDetail(itemId) {
  const targets = JSON.parse(await new Promise(r => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => r(d));
    });
  }));
  
  const page = targets.find(t => (t.url || '').includes('goofish.com'));
  if (!page) return null;
  
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  
  let cmdId = 1;
  const pending = new Map();
  let result = null;
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id) {
      const h = pending.get(msg.id);
      if (h) { clearTimeout(h.t); pending.delete(msg.id); h.r(msg); }
    }
  });
  
  const send = (m, p) => new Promise(r => {
    const id = cmdId++; const t = setTimeout(() => { pending.delete(id); r(null); }, 30000);
    pending.set(id, { r, t }); ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  
  // 在页面中通过 MTOP 库调用 detail API
  // 方法1: 使用页面加载的 lib-mtop (window.mtop)
  // 方法2: 直接用 fetch 并依靠浏览器自动处理 cookie
  // 先试试方法2 - 因为浏览器会自动处理 HttpOnly cookies
  const evalResult = await send('Runtime.evaluate', {
    awaitPromise: true,
    expression: `
      (async function() {
        try {
          // 先导航到商品页（这会触发所有API调用，Chrome自动处理x5sec）
          // 但为了避免导航，我们直接用 fetch 调用 MTOP API
          // 需要从 cookie 中提取 token
          const tkMatch = document.cookie.match(/_m_h5_tk=([^;]+)/);
          const token = tkMatch ? tkMatch[1].split('_')[0] : '';
          
          if (!token) {
            // 如果 _m_h5_tk 是 HttpOnly，document.cookie 拿不到
            // 我们可以尝试用已有的 mtop 库
            if (window.mtop && typeof window.mtop.request === 'function') {
              return 'HAS_MTOP_LIB';
            }
            return 'NO_TOKEN_NO_MTOP';
          }
          
          // 有 token，构造签名
          const APP_KEY = '34839810';
          const ts = Date.now();
          const data = { id: '${itemId}', returnItemDO: true, needSellerDO: true };
          const dataStr = JSON.stringify(data);
          
          // MD5 签名（用 CryptoJS 或 WebCrypto）
          const msgBuffer = new TextEncoder().encode(token + '&' + ts + '&' + APP_KEY + '&' + dataStr);
          const hashBuffer = await crypto.subtle.digest('MD5', msgBuffer);
          const sign = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
          
          const params = new URLSearchParams({
            jsv: '2.7.2', appKey: APP_KEY, t: String(ts), sign,
            v: '1.0', type: 'originaljson', api: 'mtop.taobao.idle.pc.detail',
            dataType: 'json', timeout: '20000', accountSite: 'xianyu',
            sessionOption: 'AutoLoginOnly', spm_cnt: 'a21ybx.item.0.0',
          });
          
          const url = 'https://h5api.m.goofish.com/h5/mtop.taobao.idle.pc.detail/1.0/?' + params.toString();
          const resp = await fetch(url, {
            method: 'POST',
            credentials: 'include',  // 重要：带上 cookie！
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(dataStr)
          });
          
          const text = await resp.text();
          const m = text.match(/^\\s*mtopjsonp\\d+\\s*\\((.*)\\)\\s*;?\\s*$/s);
          const json = JSON.parse(m ? m[1] : text);
          const ret = (json.ret || [''])[0];
          
          if (ret.startsWith('SUCCESS')) {
            const item = json.data?.itemDO || json.data?.item || {};
            const seller = json.data?.sellerDO || {};
            return JSON.stringify({
              ok: true,
              itemId: String(item.itemId || ''),
              title: (item.title || '').trim(),
              price: item.soldPrice || item.minPrice || '',
              views: parseInt(item.browseCnt || 0),
              wants: parseInt(item.wantCnt || 0),
              favorites: parseInt(item.collectCnt || 0),
              comments: parseInt(item.interactFavorCnt || 0),
              reviews: parseInt(item.evaluateCnt || 0),
              sellerName: seller.nick || '',
            });
          }
          return JSON.stringify({ ok: false, ret: ret.slice(0, 80) });
        } catch(e) {
          return JSON.stringify({ ok: false, error: e.message });
        }
      })()
    `
  });
  
  ws.close();
  
  const raw = evalResult?.result?.value || '';
  if (raw === 'HAS_MTOP_LIB') {
    // 使用 MTOP 库
    console.log('页面有 MTOP 库，尝试通过 MTOP 调用...');
    // 简化处理：先返回失败
    return null;
  }
  if (raw === 'NO_TOKEN_NO_MTOP') {
    console.log('❌ 无法获取 token（HttpOnly cookie）');
    console.log('   需要让页面先通过 MTOP 库发起请求，我们截获响应');
    return null;
  }
  
  try {
    return JSON.parse(raw);
  } catch(e) {
    console.log('❌ 解析失败:', raw.slice(0, 100));
    return null;
  }
}

async function main() {
  const itemId = process.argv[2] || '1061901376412';
  
  console.log('=' * 50);
  console.log('  x5sec 最终方案');
  console.log('=' + '=' * 50);
  console.log();
  
  const detail = await fetchDetail(itemId);
  
  if (detail?.ok) {
    console.log('\n✅ 获取成功!\n');
    console.log(`  标题: ${detail.title}`);
    console.log(`  价格: ¥${detail.price}`);
    console.log(`  👁 浏览: ${detail.views}`);
    console.log(`  ❤️ 想要: ${detail.wants}`);
    console.log(`  ⭐ 收藏: ${detail.favorites}`);
    console.log(`  💬 留言: ${detail.comments}`);
    console.log(`  📝 评价: ${detail.reviews}`);
  } else if (detail) {
    console.log('\n⚠️ ' + (detail.ret || detail.error || '未知错误'));
  } else {
    console.log('\n❌ 获取失败');
  }
  
  process.exit(0);
}

main().catch(e => console.error(e));
