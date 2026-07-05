/**
 * 从商品页提取卖家信息（从DOM和API两种方式）
 */
import http from 'http';
import WebSocket from 'ws';

const itemId = process.argv[2] || '2217571424592';

async function main() {
  // 创建新页面
  const pageInfo = await new Promise(r => {
    const req = http.request(`http://127.0.0.1:9222/json/new?about:blank`, { method: 'PUT' }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
    }); req.end();
  });
  
  const ws = await new Promise(r => { const w = new WebSocket(pageInfo.webSocketDebuggerUrl); w.on('open', () => r(w)); });
  let cmdId = 1;
  const pending = new Map();
  let apiResults = [];
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id) {
      const h = pending.get(msg.id);
      if (h) { clearTimeout(h.t); pending.delete(msg.id); h.r(msg); }
    } else if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response?.url || '';
      if (url.includes('h5api.m.goofish.com/h5/mtop.')) {
        const rid = msg.params.requestId;
        setTimeout(async () => {
          try {
            const id2 = cmdId++;
            ws.send(JSON.stringify({ id: id2, method: 'Network.getResponseBody', params: { requestId: rid } }));
            const result = await new Promise(r => pending.set(id2, { r, t: setTimeout(() => r({result:{}}), 5000) }));
            const text = result.result?.body || '';
            if (text) {
              let parsed;
              const m = text.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
              if (m) try { parsed = JSON.parse(m[1]); } catch(e) {}
              else try { parsed = JSON.parse(text); } catch(e) {}
              if (parsed) {
                // 查找所有可能包含sellerId的字段
                const data = parsed.data || {};
                const findId = (obj, depth = 0) => {
                  if (depth > 4 || !obj || typeof obj !== 'object') return null;
                  if (obj.sellerId) return { sellerId: obj.sellerId, nick: obj.nick, source: obj };
                  for (const v of Object.values(obj)) {
                    if (typeof v === 'object') {
                      const found = findId(v, depth + 1);
                      if (found) return found;
                    }
                  }
                  return null;
                };
                const found = findId(data);
                if (found) {
                  console.log(`\n✅ 找到卖家信息!`);
                  console.log(`   sellerId: ${found.sellerId}`);
                  console.log(`   nick: ${found.nick || '?'}`);
                  apiResults.push(found);
                }
              }
            }
          } catch(e) {}
        }, 200);
      }
    }
  });
  
  const send = (m, p) => new Promise(r => {
    const id = cmdId++;
    pending.set(id, { r, t: setTimeout(() => r({}), 15000) });
    ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  
  await send('Network.enable');
  await send('Page.enable');
  
  console.log(`⏳ 导航到商品 ${itemId}...`);
  await send('Page.navigate', { url: `https://www.goofish.com/item/${itemId}` });
  await new Promise(r => setTimeout(r, 8000));
  
  // 从页面DOM提取卖家信息
  console.log('⏳ 从页面DOM提取卖家信息...');
  const result = await send('Runtime.evaluate', {
    expression: `
      (function() {
        // 方法1: 查找包含用户信息的元素
        const pageText = document.body.innerText || '';
        
        // 方法2: 查找可能的卖家信息元素
        const allLinks = Array.from(document.querySelectorAll('a[href*=\"userId\"]'));
        if (allLinks.length > 0) {
          const href = allLinks[0].href;
          const match = href.match(/userId=(\\d+)/);
          if (match) return { method: 'link', userId: match[1], href: href };
        }
        
        // 方法3: 检查页面中所有文本找username/卖家名
        const userMatch = pageText.match(/卖家[：:](\\S+)/);
        
        return { 
          method: 'text', 
          hasUserId: pageText.includes('userId'), 
          userText: userMatch ? userMatch[1] : '',
          sample: pageText.substring(0, 2000) 
        };
      })()
    `
  });
  
  const domInfo = result.result?.value || {};
  console.log('\n📄 页面信息:');
  
  if (domInfo.method === 'link') {
    console.log(`✅ 从链接找到userId: ${domInfo.userId}`);
    console.log(`   链接: ${domInfo.href}`);
    console.log(`\n📋 监控命令: node shop_monitor_v2.mjs --userId=${domInfo.userId}`);
  } else {
    console.log(`   页面文本样本 (前500字):`);
    console.log(`   ${(domInfo.sample || '').substring(0, 500)}`);
    
    if (apiResults.length > 0) {
      console.log(`\n✅ 从API找到卖家信息!`);
      console.log(`   sellerId: ${apiResults[0].sellerId}`);
      console.log(`   nick: ${apiResults[0].nick || '?'}`);
    } else {
      console.log('\n❌ 页面中未找到卖家信息');
      console.log('\n💡 请手动操作:');
      console.log('   1. 在Chrome中打开这个商品');
      console.log('   2. 点击卖家名称进入店铺页');
      console.log('   3. 把地址栏URL中的userId发给我');
    }
  }
  
  ws.close();
  process.exit(0);
}

main().catch(e => { console.error('错误:', e); process.exit(1); });
