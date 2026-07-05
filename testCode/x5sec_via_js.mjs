/**
 * x5sec 终极方案：通过 CDP 在已有页面中执行 JS 来调用 API
 * 
 * 原理：让 Chrome 页面中的 JavaScript 直接调用 fetch API，
 * Chrome 自动处理 x5sec（cookie、TLS、指纹全都有）。
 * 我们通过 CDP 获取执行结果。
 */
import http from 'http';
import WebSocket from 'ws';
import crypto from 'crypto';

const CDP_PORT = 9222;
const APP_KEY = '34839810';

async function getDetailViaPageJS(itemId) {
  // 找到已有闲鱼页面
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
  
  // 在页面中执行 JavaScript 来调用 MTOP API
  // 我们需要用正确的签名调用，所以 JS 中需要构造完整请求
  const ts = Date.now();
  const data = { id: String(itemId), returnItemDO: true, needSellerDO: true };
  const dataStr = JSON.stringify(data);
  
  // 获取 token（从页面 cookie 中）
  const evalResult = await send('Runtime.evaluate', {
    expression: `(function() {
      // 从 cookie 中提取 _m_h5_tk
      const match = document.cookie.match(/_m_h5_tk=([^;]+)/);
      const tk = match ? match[1].split('_')[0] : '';
      return { token: tk, cookie: document.cookie.substring(0, 500) };
    })()`
  });
  
  const pageInfo = evalResult?.result?.value || {};
  const token = pageInfo.token || '';
  
  if (!token) {
    console.log('❌ 无法获取 token');
    ws.close();
    return null;
  }
  
  // 用 token 在 JS 中构造签名并调用 API
  const sign = crypto.createHash('md5').update(`${token}&${ts}&${APP_KEY}&${dataStr}`).digest('hex');
  
  const apiResult = await send('Runtime.evaluate', {
    expression: `(async function() {
      try {
        const params = new URLSearchParams({
          jsv: '2.7.2', appKey: '${APP_KEY}', t: '${ts}', sign: '${sign}',
          v: '1.0', type: 'originaljson', api: 'mtop.taobao.idle.pc.detail',
          dataType: 'json', timeout: '20000', accountSite: 'xianyu',
          sessionOption: 'AutoLoginOnly', spm_cnt: 'a21ybx.item.0.0',
        });
        
        const url = 'https://h5api.m.goofish.com/h5/mtop.taobao.idle.pc.detail/1.0/?' + params.toString();
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent('${dataStr.replace(/'/g, "\\'")}')
        });
        const text = await resp.text();
        const m = text.match(/^\\s*mtopjsonp\\d+\\s*\\((.*)\\)\\s*;?\\s*$/s);
        return m ? m[1] : text;
      } catch(e) {
        return 'ERROR: ' + e.message;
      }
    })()`
  });
  
  ws.close();
  
  const rawResponse = apiResult?.result?.value || '';
  if (!rawResponse || rawResponse.startsWith('ERROR:')) {
    console.log('❌ JS执行失败: ' + rawResponse);
    return null;
  }
  
  try {
    const parsed = JSON.parse(rawResponse);
    const ret = (parsed.ret || [''])[0];
    if (!ret.startsWith('SUCCESS')) {
      console.log('⚠️ API返回: ' + ret.slice(0, 60));
      return null;
    }
    
    const data = parsed.data || {};
    const item = data.itemDO || data.item || {};
    const seller = data.sellerDO || {};
    
    return {
      itemId: String(item.itemId || itemId),
      title: (item.title || '').trim(),
      price: item.soldPrice || item.minPrice || '',
      views: parseInt(item.browseCnt || 0, 10),
      wants: parseInt(item.wantCnt || 0, 10),
      favorites: parseInt(item.collectCnt || 0, 10),
      comments: parseInt(item.interactFavorCnt || 0, 10),
      reviews: parseInt(item.evaluateCnt || 0, 10),
      sellerName: seller.nick || '',
    };
  } catch(e) {
    console.log('❌ 解析失败: ' + e.message);
    return null;
  }
}

async function main() {
  const itemId = process.argv[2] || '1061901376412';
  
  console.log('=' * 50);
  console.log('  x5sec 终极方案：在Chrome中执行JS调用API');
  console.log('=' + '=' * 50);
  console.log();
  
  const detail = await getDetailViaPageJS(itemId);
  
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
  }
  
  process.exit(0);
}

main().catch(e => console.error(e));
