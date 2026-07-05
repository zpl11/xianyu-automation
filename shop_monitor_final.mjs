/**
 * 闲鱼店铺监控系统 v3.0 (最终版)
 * ==============================
 * 混合模式:
 *   - 店铺商品列表 → 直接 API 调用 (快速，无需浏览器)
 *   - 商品5维数据  → CDP 浏览器 (需要 x5sec 安全验证)
 * 
 * 用法:
 *   node shop_monitor_final.mjs shop --userId=2217571424592       # 查店铺商品
 *   node shop_monitor_final.mjs scan --userId=2217571424592       # 全量扫描(含5维数据)
 *   node shop_monitor_final.mjs monitor --userId=2217571424592     # 持续监控
 *   node shop_monitor_final.mjs detail --item=1061901376412       # 查商品详情
 */
import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import crypto from 'crypto';
import { URLSearchParams } from 'url';
import fs from 'fs';
import path from 'path';

const CDP_PORT = 9222;
const APP_KEY = '34839810';
const MTOP_BASE = 'https://h5api.m.goofish.com/h5';
const DATA_FILE = 'shop_data.json';
const EXPORT_DIR = 'exports';

// ============================================================
//  会话管理
// ============================================================

let _session = null;

async function getSession(refresh = false) {
  if (_session && !refresh) return _session;
  
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json`));
  const xyTarget = targets.find(t => 
    (t.url || '').includes('goofish.com') || (t.title || '').includes('闲鱼')
  );
  if (!xyTarget) throw new Error('请在Chrome中打开闲鱼页面');
  
  const ws = await wsConnect(xyTarget.webSocketDebuggerUrl);
  
  // 获取cookie
  await wsSend(ws, 'Network.enable');
  await sleep(300);
  const ckResult = await wsSend(ws, 'Network.getAllCookies');
  const all = ckResult.result?.cookies || [];
  ws.close();
  
  // 过滤关键cookie
  const keyDomains = ['.goofish.com', '.taobao.com', '.tmall.com', '.tb.cn', 'h5api.m.goofish.com'];
  const filtered = all.filter(c => keyDomains.some(d => c.domain.includes(d)));
  const cookieStr = filtered.map(c => `${c.name}=${c.value}`).join('; ');
  const tkCookie = all.find(c => c.name === '_m_h5_tk');
  const token = tkCookie ? tkCookie.value.split('_')[0] : '';
  
  _session = { cookies: cookieStr, token, cookieCount: filtered.length };
  return _session;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); })
      .on('error', reject);
  });
}

function wsConnect(url) {
  return new Promise(r => { const w = new WebSocket(url); w.on('open', () => r(w)); });
}

function wsSend(ws, method, params = {}) {
  return new Promise(r => {
    const id = Date.now() % 100000;
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) { ws.removeListener('message', handler); r(msg); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { ws.removeListener('message', handler); r({}); }, 10000);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
//  直接 API 调用 (xyh.item.list 不需要 x5sec)
// ============================================================

function signRequest(token, ts, dataStr) {
  return crypto.createHash('md5').update(`${token}&${ts}&${APP_KEY}&${dataStr}`).digest('hex');
}

async function callMTOP(apiName, data, extraParams = {}) {
  const session = await getSession();
  const ts = Date.now();
  const dataStr = JSON.stringify(data);
  const sign = signRequest(session.token, ts, dataStr);
  
  const params = {
    jsv: '2.7.2', appKey: APP_KEY, t: String(ts), sign,
    v: '1.0', type: 'originaljson', api: `mtop.${apiName}`,
    dataType: 'json', timeout: '20000', accountSite: 'xianyu',
    sessionOption: 'AutoLoginOnly', ...extraParams,
  };
  
  const url = `${MTOP_BASE}/mtop.${apiName}/1.0/?${new URLSearchParams(params)}`;
  
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Cookie': session.cookies,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://www.goofish.com', 'Referer': 'https://www.goofish.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    }, (res) => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const m = body.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
          resolve(m ? JSON.parse(m[1]) : JSON.parse(body));
        } catch(e) { reject(new Error('解析失败: ' + body.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(`data=${encodeURIComponent(dataStr)}`); req.end();
  });
}

// ============================================================
//  数据存储
// ============================================================

class Store {
  constructor(filepath) {
    this.filepath = filepath;
    try { this.data = JSON.parse(fs.readFileSync(filepath, 'utf-8')); }
    catch(e) { this.data = { items: {}, changes: [] }; }
  }
  
  save() {
    const dir = path.dirname(this.filepath);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2), 'utf-8');
  }
  
  updateItem(itemData) {
    const id = itemData.itemId;
    if (!id) return;
    const now = new Date().toISOString();
    const item = this.data.items[id];
    
    if (!item) {
      this.data.items[id] = {
        itemId: id, title: itemData.title || '', price: itemData.price || '',
        url: `https://www.goofish.com/item/${id}`,
        firstSeen: now, lastSeen: now, checkCount: 1,
        views: itemData.views || 0, wants: itemData.wants || 0,
        favorites: itemData.favorites || 0, comments: itemData.comments || 0,
        reviews: itemData.reviews || 0,
        history: [{ timestamp: now, title: itemData.title, price: itemData.price }],
        changes: [{ timestamp: now, type: 'NEW', message: '新商品上架' }],
      };
      this.data.changes.push({ timestamp: now, itemId: id, type: 'NEW', message: itemData.title?.slice(0, 30) || '新商品' });
      console.log(`  🆕 ${(itemData.title || '').slice(0, 30)}`);
    } else {
      item.lastSeen = now;
      item.checkCount++;
      
      // 检测标题/价格变更
      if (itemData.title && item.title !== itemData.title) {
        const msg = `标题: "${item.title}" → "${itemData.title}"`;
        item.changes.push({ timestamp: now, type: 'TITLE_CHANGE', message: msg });
        this.data.changes.push({ timestamp: now, itemId: id, type: 'TITLE_CHANGE', message: msg });
        item.title = itemData.title;
      }
      if (itemData.price && item.price !== itemData.price) {
        const msg = `价格: ${item.price} → ${itemData.price}`;
        item.changes.push({ timestamp: now, type: 'PRICE_CHANGE', message: msg });
        this.data.changes.push({ timestamp: now, itemId: id, type: 'PRICE_CHANGE', message: msg });
        item.price = itemData.price;
      }
      
      // 更新5维数据
      const hEntry = { timestamp: now, title: item.title, price: item.price };
      for (const dim of ['views', 'wants', 'favorites', 'comments', 'reviews']) {
        if (itemData[dim] !== undefined) {
          const old = item[dim];
          if (old !== itemData[dim] && itemData[dim] > 0) {
            const msg = `${dim}: ${old} → ${itemData[dim]}`;
            item.changes.push({ timestamp: now, type: 'STATS_CHANGE', message: msg });
            this.data.changes.push({ timestamp: now, itemId: id, type: 'STATS_CHANGE', message: msg });
          }
          if (itemData[dim] > 0) item[dim] = itemData[dim];
          hEntry[dim] = itemData[dim];
        }
      }
      item.history.push(hEntry);
      if (item.history.length > 500) item.history = item.history.slice(-500);
    }
    this.save();
  }
  
  exportCSV() {
    const dir = EXPORT_DIR;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, `闲鱼监控_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
    
    const items = Object.values(this.data.items);
    const fields = ['itemId', 'title', 'price', 'views', 'wants', 'favorites', 'comments', 'reviews', 'firstSeen', 'lastSeen', 'checkCount', 'url'];
    const BOM = '\uFEFF';
    const header = fields.join(',');
    const rows = items.map(item => fields.map(f => `"${String(item[f] || '').replace(/"/g, '""')}"`).join(','));
    fs.writeFileSync(filepath, BOM + header + '\n' + rows.join('\n'), 'utf-8');
    console.log(`\n📤 已导出 ${items.length} 条: ${filepath}`);
  }
}

// ============================================================
//  CDP 5维数据采集 (需要 x5sec)
// ============================================================

async function fetchDetailViaCDP(itemId) {
  /** 通过CDP浏览器获取商品详情5维数据 */
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json`));
  // 创建新页面
  const newPage = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, 'PUT'));
  
  const ws = await wsConnect(newPage.webSocketDebuggerUrl);
  let cmdId = 1;
  const pending = new Map();
  let detailData = null;
  
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
          try {
            const id2 = cmdId++;
            ws.send(JSON.stringify({ id: id2, method: 'Network.getResponseBody', params: { requestId: rid } }));
            const result = await new Promise(r => pending.set(id2, { r, t: setTimeout(() => r({}), 5000) }));
            const text = result.result?.body || '';
            if (!text) return;
            const m = text.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
            const parsed = m ? JSON.parse(m[1]) : JSON.parse(text);
            const data = parsed.data || {};
            const item = data.itemDO || data.item || {};
            const seller = data.sellerDO || {};
            if (item.itemId && String(item.itemId) === String(itemId)) {
              detailData = {
                itemId: String(item.itemId),
                title: (item.title || '').trim(),
                price: item.soldPrice || item.minPrice || '',
                views: parseInt(item.browseCnt || 0, 10),
                wants: parseInt(item.wantCnt || 0, 10),
                favorites: parseInt(item.collectCnt || 0, 10),
                comments: parseInt(item.interactFavorCnt || 0, 10),
                reviews: parseInt(item.evaluateCnt || 0, 10),
                sellerId: String(seller.sellerId || ''),
                sellerName: seller.nick || '',
              };
            }
          } catch(e) {}
        }, 200);
      }
    }
  });
  
  const cdps = (m, p) => new Promise(r => {
    const id = cmdId++; const t = setTimeout(() => { pending.delete(id); r({}); }, 20000);
    pending.set(id, { r, t }); ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  
  await cdps('Network.enable');
  await cdps('Page.enable');
  await cdps('Page.navigate', { url: `https://www.goofish.com/item/${itemId}` });
  await sleep(6000);
  
  ws.close();
  return detailData;
}

// ============================================================
//  主流程
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const getArg = (k) => { for (const a of args) if (a.startsWith(`--${k}=`)) return a.split('=')[1]; return null; };
  
  console.log('=' * 55);
  console.log('  闲鱼店铺监控系统 v3.0');
  console.log('=' * 55);
  
  const store = new Store(DATA_FILE);
  
  // ----- shop: 查店铺商品列表 (直连API) -----
  if (cmd === 'shop') {
    const userId = getArg('userId');
    if (!userId) return console.log('请指定 --userId');
    
    const result = await callMTOP('idle.web.xyh.item.list', {
      needGroupInfo: true, pageNumber: 1, userId, pageSize: 20,
    }, { spm_cnt: 'a21ybx.personal.0.0' });
    
    const items = (result.data?.cardList || []).map(c => {
      const cd = c.cardData || {};
      return {
        itemId: String(cd.id || ''),
        title: cd.title || '',
        price: cd.priceInfo?.price || '',
      };
    }).filter(i => i.itemId);
    
    console.log(`\n共 ${items.length} 个商品:\n`);
    items.forEach((item, i) => {
      console.log(`  ${i+1}. [${item.itemId}] ${item.title.slice(0, 40).padEnd(42)} ¥${item.price || '?'}`);
      store.updateItem(item);
    });
    store.exportCSV();
  }
  
  // ----- scan: 全量扫描 (含5维数据) -----
  else if (cmd === 'scan') {
    const userId = getArg('userId');
    if (!userId) return console.log('请指定 --userId');
    
    // 1. 直连API获取商品列表
    console.log('\n📦 获取商品列表...');
    const listResult = await callMTOP('idle.web.xyh.item.list', {
      needGroupInfo: true, pageNumber: 1, userId, pageSize: 20,
    }, { spm_cnt: 'a21ybx.personal.0.0' });
    
    const items = (listResult.data?.cardList || []).map(c => {
      const cd = c.cardData || {};
      return { itemId: String(cd.id || ''), title: cd.title || '', price: cd.priceInfo?.price || '' };
    }).filter(i => i.itemId);
    
    console.log(`\n共 ${items.length} 个商品`);
    items.forEach(item => store.updateItem(item));
    
    // 2. CDP获取5维数据
    console.log('\n📊 通过浏览器获取5维数据 (限前5个)...');
    for (const item of items.slice(0, 5)) {
      console.log(`  ⏳ ${item.title.slice(0, 30)}...`);
      const detail = await fetchDetailViaCDP(item.itemId);
      if (detail) {
        store.updateItem(detail);
        console.log(`     👁${detail.views} ❤️${detail.wants} ⭐${detail.favorites} 💬${detail.comments}`);
      } else {
        console.log(`     ❌ 获取失败（需要手动打开商品页登录验证）`);
      }
      await sleep(2000);
    }
    
    store.exportCSV();
    printReport(store);
  }
  
  // ----- detail: 商品详情 -----
  else if (cmd === 'detail') {
    const itemId = getArg('item');
    if (!itemId) return console.log('请指定 --item');
    
    console.log(`\n📄 商品详情: ${itemId}`);
    
    // 尝试CDP
    const detail = await fetchDetailViaCDP(itemId);
    if (detail) {
      console.log(`  标题: ${detail.title}`);
      console.log(`  价格: ¥${detail.price}`);
      console.log(`  👁 浏览: ${detail.views}`);
      console.log(`  ❤️ 想要: ${detail.wants}`);
      console.log(`  ⭐ 收藏: ${detail.favorites}`);
      console.log(`  💬 留言: ${detail.comments}`);
      console.log(`  📝 评价: ${detail.reviews}`);
      console.log(`  卖家: ${detail.sellerName} (ID: ${detail.sellerId})`);
      store.updateItem(detail);
    } else {
      console.log('  ❌ 需要手动在Chrome中打开该商品页完成安全验证');
      console.log('    打开后重新运行即可');
    }
  }
  
  else {
    console.log('\n用法:');
    console.log('  node shop_monitor_final.mjs shop --userId=店铺ID     # 快速查看商品列表');
    console.log('  node shop_monitor_final.mjs scan --userId=店铺ID     # 全量扫描(含5维)');
    console.log('  node shop_monitor_final.mjs detail --item=商品ID      # 查商品详情');
  }
}

function printReport(store) {
  const items = Object.values(store.data.items);
  console.log('\n' + '=' * 55);
  console.log('  📊 监控报告');
  console.log('=' + '=' * 55);
  console.log(`  商品数: ${items.length}`);
  console.log(`  变更数: ${store.data.changes.length}`);
  
  const sorted = items.sort((a, b) => (b.views || 0) - (a.views || 0));
  sorted.slice(0, 5).forEach((item, i) => {
    console.log(`  ${i+1}. ${(item.title || '?').slice(0, 25).padEnd(25)} 👁${item.views || 0} ❤️${item.wants || 0}`);
  });
  console.log('=' + '=' * 55 + '\n');
}

main().catch(e => { console.error(`\n❌ ${e.message}`); process.exit(1); });
