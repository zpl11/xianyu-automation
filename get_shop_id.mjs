/**
 * 获取闲鱼店铺ID工具
 * 
 * 用法:
 *   node get_shop_id                   # 从当前Chrome闲鱼页面自动提取
 *   node get_shop_id --item=商品ID     # 从任意商品ID反查店铺ID
 * 
 * 手动方法:
 *   1. 在Chrome打开任意一个该店铺的商品详情页
 *   2. 点击卖家昵称旁边的箭头 → 进入卖家主页
 *   3. 浏览器地址栏URL中 userId=XXXXX 就是店铺ID
 *      例如: https://www.goofish.com/personal?userId=4252893945
 *   4. 或使用本工具自动提取
 */
import http from 'http';
import WebSocket from 'ws';

const CDP_PORT = 9222;

// ===== CDP 辅助函数 =====

async function findXianyuPage() {
  const data = await new Promise(r => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => r(JSON.parse(d)));
    });
  });
  
  // 找闲鱼页面
  const xyPages = data.filter(t => 
    (t.url || '').includes('goofish.com') || (t.title || '').includes('闲鱼')
  );
  
  if (xyPages.length === 0) {
    console.log('❌ 未找到闲鱼页面');
    console.log('   请在Chrome中打开一个闲鱼商品页或店铺页');
    return null;
  }
  
  return xyPages[0];
}

async function extractFromCurrentPage() {
  /** 从当前Chrome闲鱼页面提取userId */
  console.log('🔍 扫描Chrome中的闲鱼页面...\n');
  
  const target = await findXianyuPage();
  if (!target) return null;
  
  console.log(`📄 找到页面: ${target.title}`);
  console.log(`🔗 URL: ${(target.url || '').slice(0, 120)}`);
  console.log();
  
  // 从URL直接提取userId
  const urlMatch = (target.url || '').match(/userId=(\d+)/);
  if (urlMatch) {
    console.log(`✅ 从URL提取到店铺ID: ${urlMatch[1]}`);
    return urlMatch[1];
  }
  
  // 从商品详情页提取 - 连接到页面抓取API响应
  console.log('⏳ 页面中没有userId，尝试从API提取...');
  
  const ws = await new Promise(r => {
    const w = new WebSocket(target.webSocketDebuggerUrl);
    w.on('open', () => r(w));
  });
  
  let cmdId = 1;
  const pending = new Map();
  
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
          const id2 = cmdId++;
          ws.send(JSON.stringify({ id: id2, method: 'Network.getResponseBody', params: { requestId: rid } }));
        }, 100);
      }
    }
  });
  
  const send = (m, p) => new Promise(r => {
    const id = cmdId++;
    pending.set(id, { r, t: setTimeout(() => r({}), 8000) });
    ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  
  await send('Network.enable');
  
  // 刷新页面触发API
  console.log('⏳ 刷新页面获取API数据...');
  await send('Page.reload');
  await new Promise(r => setTimeout(r, 5000));
  
  // 等待API响应
  await new Promise(r => setTimeout(r, 3000));
  
  // 收集解析结果
  const results = [];
  for (const [id, h] of pending) {
    try {
      const result = await new Promise(r => {
        pending.set(id, { r, t: setTimeout(() => r({result:{}}), 2000) });
        ws.send(JSON.stringify({ id: cmdId++, method: 'Network.getResponseBody', params: { requestId: id } }));
      });
      const text = result.result?.body || '';
      if (text) {
        let parsed;
        const m = text.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
        if (m) { try { parsed = JSON.parse(m[1]); } catch(e) {} }
        else { try { parsed = JSON.parse(text); } catch(e) {} }
        if (parsed) results.push(parsed);
      }
    } catch(e) {}
  }
  
  // 搜索sellerId
  for (const r of results) {
    const data = r.data || {};
    const seller = data.sellerDO || {};
    if (seller.sellerId) {
      console.log(`✅ 从API响应提取到店铺ID: ${seller.sellerId}`);
      console.log(`   店铺名: ${seller.nick || '?'}`);
      ws.close();
      return seller.sellerId;
    }
  }
  
  // 从itemDO中查找sellerId
  for (const r of results) {
    const data = r.data || {};
    if (data.itemDO?.sellerId) {
      console.log(`✅ 从商品数据提取到店铺ID: ${data.itemDO.sellerId}`);
      ws.close();
      return data.itemDO.sellerId;
    }
  }
  
  // 在data的任何字段中查找sellerId
  for (const r of results) {
    const data = r.data || {};
    if (typeof data === 'object') {
      const findId = (obj, depth = 0) => {
        if (depth > 3 || !obj) return null;
        if (obj.sellerId) return obj.sellerId;
        if (obj.userId) return obj.userId;
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
        console.log(`✅ 从深层数据提取到店铺ID: ${found}`);
        ws.close();
        return found;
      }
    }
  }
  
  console.log('❌ 无法提取店铺ID');
  console.log('   请手动打开店铺页: https://www.goofish.com/personal?userId=店铺ID');
  ws.close();
  return null;
}

async function extractFromItemId(itemId) {
  /** 从商品ID反查店铺ID */
  console.log(`🔍 从商品 ${itemId} 反查店铺ID...\n`);
  
  const target = await findXianyuPage();
  if (!target) return null;
  
  const ws = await new Promise(r => {
    const w = new WebSocket(target.webSocketDebuggerUrl);
    w.on('open', () => r(w));
  });
  
  let cmdId = 1;
  const pending = new Map();
  let sellerId = null;
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id) {
      const h = pending.get(msg.id);
      if (h) { clearTimeout(h.t); pending.delete(msg.id); h.r(msg); }
    } else if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response?.url || '';
      if (url.includes('pc.detail') || url.includes('item.detail')) {
        const rid = msg.params.requestId;
        setTimeout(async () => {
          const id2 = cmdId++;
          ws.send(JSON.stringify({ id: id2, method: 'Network.getResponseBody', params: { requestId: rid } }));
        }, 100);
      }
    }
  });
  
  const send = (m, p) => new Promise(r => {
    const id = cmdId++;
    pending.set(id, { r, t: setTimeout(() => r({}), 15000) });
    ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  
  await send('Network.enable');
  
  console.log('⏳ 打开商品详情页...');
  await send('Page.navigate', { url: `https://www.goofish.com/item/${itemId}` });
  await new Promise(r => setTimeout(r, 8000));
  
  // 收集响应
  console.log('⏳ 提取API数据...');
  await new Promise(r => setTimeout(r, 3000));
  
  // 解析响应
  const results = [];
  const processItem = async (rid) => {
    try {
      const result = await new Promise(r => {
        const id = cmdId++;
        pending.set(id, { r, t: setTimeout(() => r({result:{}}), 3000) });
        ws.send(JSON.stringify({ id, method: 'Network.getResponseBody', params: { requestId: rid } }));
      });
      const text = result.result?.body || '';
      if (text) {
        let parsed;
        const m = text.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
        if (m) { try { parsed = JSON.parse(m[1]); } catch(e) {} }
        else { try { parsed = JSON.parse(text); } catch(e) {} }
        if (parsed) results.push(parsed);
      }
    } catch(e) {}
  };
  
  // 找detail API的响应
  for (const [id, h] of pending) {
    if (typeof id === 'string' && id.includes('.')) {
      await processItem(id);
    }
  }
  
  for (const r of results) {
    const data = r.data || {};
    const seller = data.sellerDO || {};
    if (seller.sellerId) {
      sellerId = String(seller.sellerId);
      console.log(`\n✅ 提取到店铺信息:`);
      console.log(`   店铺ID: ${sellerId}`);
      console.log(`   店铺名: ${seller.nick || '?'}`);
      console.log(`   监qu命令: node shop_monitor_v2.mjs --userId=${sellerId}`);
      break;
    }
  }
  
  ws.close();
  
  if (!sellerId) {
    console.log('\n❌ 无法反查店铺ID（可能需要登录）');
    console.log('   手动方法: 点击卖家名称进入店铺页，从URL获取userId');
  }
  
  return sellerId;
}

// ===== 主入口 =====

async function main() {
  const args = process.argv.slice(2);
  const itemArg = args.find(a => a.startsWith('--item='));
  
  console.log('=' * 55);
  console.log('  闲鱼店铺ID提取工具');
  console.log('=' * 55);
  console.log();
  
  if (itemArg) {
    const itemId = itemArg.split('=')[1];
    await extractFromItemId(itemId);
  } else {
    const id = await extractFromCurrentPage();
    if (id) {
      console.log(`\n📋 使用方法:`);
      console.log(`  一次采集: node shop_monitor_v2.mjs --userId=${id}`);
      console.log(`  持续监控: node shop_monitor_v2.mjs --userId=${id} --interval=300`);
    }
  }
  
  console.log();
  console.log('=' * 55);
  console.log('  手动获取店铺ID的方法:');
  console.log('=' * 55);
  console.log();
  console.log('  方法1: 从商品详情找卖家');
  console.log('    1. 在Chrome打开想监控的店铺的任意商品');
  console.log('    2. 点击卖家名称 → 进入卖家店铺页');
  console.log('    3. 地址栏URL中 userId=数字 就是店铺ID');
  console.log();
  console.log('  方法2: 用本工具自动提取');
  console.log(`    node get_shop_id --item=已知商品ID`);
  console.log();
  console.log('  方法3: 直接询问卖家');
  console.log('    卖家主页URL: https://www.goofish.com/personal?userId=数字');
  console.log();
}

main().catch(e => console.error('❌ 错误:', e.message));
