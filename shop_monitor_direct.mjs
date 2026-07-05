/**
 * 闲鱼店铺监控系统 —— 纯API直连版
 * ===============================
 * 通过 Chrome 提取 Cookie/Token 后，全用直接 HTTP API 调用，
 * 不需要打开浏览器，不需要 CDP 连接。
 * 
 * 用法:
 *   node shop_monitor_direct.mjs --userId=2217571424592
 *   node shop_monitor_direct.mjs --userId=2217571424592 --interval=300
 *   node shop_monitor_direct.mjs --export
 *   node shop_monitor_direct.mjs --report
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
const DATA_FILE = 'shop_data.json';
const EXPORT_DIR = 'exports';

// ============================================================
//  一次性：从 Chrome 提取 Cookie/Token（只需一次，可复用）
// ============================================================

let _session = null;

async function getSession(refresh = false) {
  if (_session && !refresh) return _session;
  
  // 通过 CDP 获取 cookie（仅这一次，不是持续连接）
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json`));
  const xyTarget = targets.find(t => 
    (t.url || '').includes('goofish.com') || (t.title || '').includes('闲鱼')
  );
  if (!xyTarget) throw new Error('请在 Chrome 中打开一个闲鱼页面（任意页面即可）');
  
  const ws = await wsConnect(xyTarget.webSocketDebuggerUrl);
  await wsSend(ws, 'Network.enable');
  await sleep(300);
  const ckResult = await wsSend(ws, 'Network.getAllCookies');
  ws.close();
  
  const allCookies = ckResult.result?.cookies || [];
  const keyDomains = ['.goofish.com', '.taobao.com', '.tb.cn', 'h5api.m.goofish.com', 'passport.goofish.com'];
  const keepCookies = allCookies.filter(c => keyDomains.some(d => c.domain.includes(d)));
  
  // 构建完整 cookie 字符串
  const cookieStr = keepCookies.map(c => `${c.name}=${c.value}`).join('; ');
  
  // 提取 _m_h5_tk token
  const tkCookie = allCookies.find(c => c.name === '_m_h5_tk');
  const token = tkCookie ? tkCookie.value.split('_')[0] : '';
  
  _session = { cookies: cookieStr, token, fetchedAt: Date.now() };
  console.log(`✅ 已获取 Cookie (${keepCookies.length} 个), Token: ${token.slice(0, 10)}...`);
  return _session;
}

// ============================================================
//  MTOP API 签名与调用
// ============================================================

function signMTOP(token, ts, dataStr) {
  return crypto.createHash('md5').update(`${token}&${ts}&${APP_KEY}&${dataStr}`).digest('hex');
}

async function callMTOP(apiName, data, extraParams = {}) {
  const s = await getSession();
  const ts = Date.now();
  const dataStr = JSON.stringify(data);
  const sign = signMTOP(s.token, ts, dataStr);
  
  const params = {
    jsv: '2.7.2', appKey: APP_KEY, t: String(ts), sign,
    v: '1.0', type: 'originaljson', api: `mtop.${apiName}`,
    dataType: 'json', timeout: '20000', accountSite: 'xianyu',
    sessionOption: 'AutoLoginOnly', ...extraParams,
  };
  
  const url = `https://h5api.m.goofish.com/h5/mtop.${apiName}/1.0/?${new URLSearchParams(params)}`;
  
  return new Promise((resolve, reject) => {
    const bodyData = `data=${encodeURIComponent(dataStr)}`;
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Cookie': s.cookies,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyData),
        'Origin': 'https://www.goofish.com',
        'Referer': 'https://www.goofish.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const m = body.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
          resolve(m ? JSON.parse(m[1]) : JSON.parse(body));
        } catch(e) {
          console.error('  原始响应:', body.slice(0, 300));
          reject(new Error(`解析失败 (${res.statusCode})`));
        }
      });
    });
    req.on('error', reject);
    req.write(bodyData);
    req.end();
  });
}

// ============================================================
//  API 业务封装
// ============================================================

async function getShopItems(userId) {
  /** 获取店铺所有在售商品（分页） */
  const allCards = [];
  const uid = String(userId);
  let page = 1;
  const pageSize = 20;
  
  while (true) {
    const result = await callMTOP('idle.web.xyh.item.list', {
      needGroupInfo: true, pageNumber: page, userId: uid, pageSize,
    }, { spm_cnt: 'a21ybx.personal.0.0' });
    
    const cards = result.data?.cardList || [];
    allCards.push(...cards);
    
    const ret = result.ret?.[0] || '';
    if (page === 1 && !ret.startsWith('SUCCESS')) {
      console.log(`  ⚠️ API响应异常: ${ret.slice(0, 60)}`);
    }
    
    const nextPage = result.data?.nextPage || result.data?.nextPageNum;
    if (!nextPage || cards.length < pageSize || page > 50) break;
    page++;
  }
  
  console.log(`  共 ${allCards.length} 个商品 (${page}页)`);
  
  return allCards.map(card => {
    const cd = card.cardData || {};
    return {
      itemId: String(cd.id || ''),
      title: cd.title || '',
      price: cd.priceInfo?.price || '',
      image: cd.picInfo?.url || '',
      status: cd.itemStatus || '',
      detailUrl: cd.detailUrl || '',
    };
  }).filter(i => i.itemId);
}

// ============================================================
//  数据存储
// ============================================================

class Store {
  constructor(filepath) {
    this.filepath = filepath;
    try { this.data = JSON.parse(fs.readFileSync(filepath, 'utf-8')); } 
    catch(e) { this.data = { items: {}, changes: [], config: {} }; }
  }
  
  save() {
    const dir = path.dirname(this.filepath) || '.';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2), 'utf-8');
  }
  
  syncItems(apiItems) {
    /** 将API获取的商品列表同步到存储，检测变更 */
    const now = new Date().toISOString();
    const apiIds = new Set(apiItems.map(i => i.itemId));
    
    // 检测新商品
    for (const item of apiItems) {
      if (!this.data.items[item.itemId]) {
        this.data.items[item.itemId] = {
          itemId: item.itemId,
          title: item.title,
          price: item.price,
          url: `https://www.goofish.com/item/${item.itemId}`,
          firstSeen: now,
          lastSeen: now,
          checkCount: 1,
          status: 'active',
          history: [{ timestamp: now, title: item.title, price: item.price }],
          changes: [{ timestamp: now, type: 'NEW', message: `新商品上架: ${item.title}` }],
        };
        this.data.changes.push({ timestamp: now, itemId: item.itemId, type: 'NEW', message: item.title });
        console.log(`  🆕 ${item.title.slice(0, 35)}`);
      } else {
        const existing = this.data.items[item.itemId];
        existing.lastSeen = now;
        existing.checkCount++;
        existing.status = 'active';
        
        // 检测标题变更
        if (existing.title !== item.title) {
          const msg = `标题变更: "${existing.title}" → "${item.title}"`;
          existing.changes.push({ timestamp: now, type: 'TITLE_CHANGE', message: msg });
          this.data.changes.push({ timestamp: now, itemId: item.itemId, type: 'TITLE_CHANGE', message: msg });
          console.log(`  📝 ${msg.slice(0, 60)}`);
          existing.title = item.title;
        }
        
        // 检测价格变更
        if (existing.price !== item.price && existing.price && item.price) {
          const msg = `价格变更: ¥${existing.price} → ¥${item.price}`;
          existing.changes.push({ timestamp: now, type: 'PRICE_CHANGE', message: msg });
          this.data.changes.push({ timestamp: now, itemId: item.itemId, type: 'PRICE_CHANGE', message: msg });
          console.log(`  💰 ${msg}`);
          existing.price = item.price;
        }
        
        existing.history.push({ timestamp: now, title: item.title, price: item.price });
        if (existing.history.length > 500) existing.history = existing.history.slice(-500);
      }
    }
    
    // 检测下架商品
    for (const [id, item] of Object.entries(this.data.items)) {
      if (!apiIds.has(id) && item.status === 'active' && item.checkCount > 1) {
        item.status = 'sold_out';
        item.lastSeen = now;
        const msg = `商品已下架: ${item.title}`;
        item.changes.push({ timestamp: now, type: 'SOLD_OUT', message: msg });
        this.data.changes.push({ timestamp: now, itemId: id, type: 'SOLD_OUT', message: msg });
        console.log(`  🚫 ${msg.slice(0, 40)}`);
      }
    }
    
    this.save();
  }
  
  exportCSV() {
    if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const filepath = path.join(EXPORT_DIR, `闲鱼监控_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
    
    const items = Object.values(this.data.items).sort((a, b) => (b.views || 0) - (a.views || 0));
    const fields = ['itemId', 'title', 'price', 'status', 'firstSeen', 'lastSeen', 'checkCount', 'url'];
    const header = fields.join(',');
    const rows = items.map(item => fields.map(f => `"${String(item[f] || '').replace(/"/g, '""')}"`).join(','));
    
    fs.writeFileSync(filepath, '\uFEFF' + header + '\n' + rows.join('\n'), 'utf-8');
    console.log(`\n📤 已导出 ${items.length} 条: ${filepath}`);
  }
  
  printReport() {
    const items = Object.values(this.data.items);
    const active = items.filter(i => i.status !== 'sold_out');
    const changes = this.data.changes;
    
    console.log('\n' + '=' * 55);
    console.log('  📊 监控报告');
    console.log('=' + '=' * 55);
    console.log(`  总商品: ${items.length} | 在售: ${active.length} | 已下架: ${items.length - active.length}`);
    console.log(`  变更事件: ${changes.length}`);
    console.log();
    
    console.log('  📋 在售商品:');
    active.forEach((item, i) => {
      const title = (item.title || '?').slice(0, 30).padEnd(32);
      console.log(`  ${i+1}. ${title} ¥${item.price || '?'} (${item.checkCount}次检查)`);
    });
    
    const recentChanges = changes.slice(-10).reverse();
    if (recentChanges.length > 0) {
      console.log('\n  📝 最近变更:');
      recentChanges.forEach(c => {
        const ts = (c.timestamp || '').slice(11, 19);
        console.log(`  [${ts}] [${c.type.slice(0, 8)}] ${(c.message || '').slice(0, 50)}`);
      });
    }
    console.log('=' + '=' * 55 + '\n');
  }
}

// ============================================================
//  工具函数
// ============================================================

function httpGet(url) { return new Promise(r => { http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }); }); }
function wsConnect(url) { return new Promise(r => { const w = new WebSocket(url); w.on('open', () => r(w)); }); }
function wsSend(ws, method, params = {}) { return new Promise(r => { const id = Date.now() % 100000; const handler = (data) => { const msg = JSON.parse(data.toString()); if (msg.id === id) { ws.removeListener('message', handler); r(msg); } }; ws.on('message', handler); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { ws.removeListener('message', handler); r({}); }, 8000); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function now() { return new Date().toISOString(); }

// ============================================================
//  主入口
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const getArg = (k) => { for (const a of args) if (a.startsWith(`--${k}=`)) return a.split('=')[1]; return null; };
  
  const userId = getArg('userId');
  const interval = parseInt(getArg('interval') || '0', 10);
  
  // 导出或报告模式
  if (args.includes('--export')) {
    const store = new Store(DATA_FILE);
    store.exportCSV();
    return;
  }
  if (args.includes('--report')) {
    const store = new Store(DATA_FILE);
    store.printReport();
    return;
  }
  
  if (!userId) {
    console.log('用法:');
    console.log('  node shop_monitor_direct.mjs --userId=店铺ID              # 单次检查');
    console.log('  node shop_monitor_direct.mjs --userId=店铺ID --interval=300 # 持续监控');
    console.log('  node shop_monitor_direct.mjs --export                     # 导出CSV');
    console.log('  node shop_monitor_direct.mjs --report                     # 统计报告');
    return;
  }
  
  console.log('=' * 55);
  console.log('  闲鱼店铺监控系统 —— 纯API直连版');
  console.log('=' + '=' * 55);
  console.log(`  店铺ID: ${userId}`);
  if (interval > 0) console.log(`  监控间隔: ${interval}秒`);
  console.log();
  
  const store = new Store(DATA_FILE);
  
  // 循环检查（单次或持续）
  let round = 0;
  do {
    round++;
    if (interval > 0) console.log(`\n📌 第 ${round} 轮检查 — ${now().slice(11, 19)}`);
    
    try {
      await getSession(true);  // 每次都刷新session（获取最新cookie）
      const items = await getShopItems(userId);
      console.log(`\n📦 API返回 ${items.length} 个商品`);
      if (items.length === 0) {
        console.log('  ⚠️ API返回空列表，保留上次数据');
      } else {
        store.syncItems(items);
      }
      store.exportCSV();
      store.printReport();
    } catch (e) {
      console.error(`\n❌ 错误: ${e.message}`);
      if (e.message.includes('请在Chrome')) break;
    }
    
    if (interval > 0 && round < 9999) {
      console.log(`⏳ ${interval}秒后下一轮...`);
      await sleep(interval * 1000);
    }
  } while (interval > 0);
}

main().catch(e => { console.error(`\n❌ ${e.message}`); process.exit(1); });
