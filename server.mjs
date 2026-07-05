/**
 * 闲鱼店铺监控 Web 服务
 * =====================
 * 纯 Node.js 内置模块，零外部依赖。
 * 
 * 功能:
 *   ✅ 商品列表 (纯API)
 *   ✅ 上新/下架/标题/价格检测 (纯API)
 *   ✅ 5维数据 (点击查询，CDP静默获取)
 *   ✅ CSV导出
 * 
 * 启动:
 *   node server.mjs
 *   访问: http://localhost:3000
 */
import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import crypto from 'crypto';
import { URLSearchParams } from 'url';
import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { fileURLToPath } from 'url';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const CDP_PORT = 9222;
const APP_KEY = '34839810';
const DATA_DIR = path.join(__dirname, 'data');
const EXPORT_DIR = path.join(__dirname, 'exports');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

// ============================================================
//  会话管理
// ============================================================
let _session = { cookies: '', token: '', valid: false };

async function refreshSession() {
  try {
    const targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json`));
    const t = targets.find(t => (t.url || '').includes('goofish.com') && !t.url.includes('g.alicdn') && !t.url.includes('xdomain'));
    if (!t) return false;
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise(r => { ws.on('open', r); ws.on('error', r); setTimeout(r, 3000); });
    if (ws.readyState !== WebSocket.OPEN) return false;
    let id = 1; const p = new Map();
    ws.on('message', d => { try { const m = JSON.parse(d.toString()); if (m.id) { const h = p.get(m.id); if (h) { clearTimeout(h.t); p.delete(m.id); h.r(m); } } } catch(e) {} });
    const s = (m, par) => new Promise(r => { const i = id++; p.set(i, { r, t: setTimeout(() => { p.delete(i); r({}); }, 8000) }); ws.send(JSON.stringify({ id: i, method: m, params: par })); });
    await s('Network.enable');
    const ck = await s('Network.getAllCookies'); ws.close();
    const all = ck.result?.cookies || [];
    const keep = all.filter(c => ['.goofish.com','.taobao.com','.tb.cn','h5api.m.goofish.com'].some(d => c.domain.includes(d)));
    const tk = all.find(c => c.name === '_m_h5_tk');
    _session = { cookies: keep.map(c => `${c.name}=${c.value}`).join('; '), token: tk ? tk.value.split('_')[0] : '', valid: !!tk, count: keep.length };
    return _session.valid;
  } catch(e) { _session.valid = false; return false; }
}

// ============================================================
//  MTOP API 调用
// ============================================================
async function callMTOP(apiName, data, extraParams = {}) {
  if (!_session.valid) throw new Error('未登录');
  const ts = Date.now();
  const dataStr = JSON.stringify(data);
  const sign = crypto.createHash('md5').update(`${_session.token}&${ts}&${APP_KEY}&${dataStr}`).digest('hex');
  const params = { jsv: '2.7.2', appKey: APP_KEY, t: String(ts), sign, v: '1.0', type: 'originaljson', api: `mtop.${apiName}`, dataType: 'json', timeout: '20000', accountSite: 'xianyu', sessionOption: 'AutoLoginOnly', ...extraParams };
  const url = `https://h5api.m.goofish.com/h5/mtop.${apiName}/1.0/?${new URLSearchParams(params)}`;
  
  const bd = `data=${encodeURIComponent(dataStr)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('请求超时 (15s)')), 15000);
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Cookie': _session.cookies,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://www.goofish.com',
        'Referer': 'https://www.goofish.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      body: bd,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      return { ret: [`FAIL_HTTP_${res.status}`], data: null };
    }
    
    const body = await res.text();
    try {
      const m = body.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
      return m ? JSON.parse(m[1]) : JSON.parse(body);
    } catch (e) {
      return { ret: ['FAIL_PARSE_ERROR'], data: null };
    }
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// ============================================================
//  直接调用 pc.detail API 获取商品5维数据
// ============================================================
async function fetchItemStats(itemId) {
  try {
    let result = await callMTOP('taobao.idle.pc.detail', { itemId: String(itemId) }, { spm_cnt: 'a21ybx.item.0.0' });
    let ret = result.ret?.[0] || '';
    
    if (ret.includes('FAIL_SYS_USER_VALIDATE')) {
      return { x5sec_expired: true };
    }
    if (!ret.startsWith('SUCCESS')) return null;
    
    const data = result.data || {};
    let item = data.itemDO || data.item || {};
    const seller = data.sellerDO || data.b2cSellerDO || {};
    if (!item.itemId) {
      const b2c = data.b2cItemDO || {};
      if (b2c.browseCnt !== undefined) item = { itemId: String(itemId), ...b2c };
      else return null;
    }
    
    return {
      views: parseInt(item.browseCnt || 0, 10),
      wants: parseInt(item.wantCnt || item.wantBuyCount || 0, 10),
      favorites: parseInt(item.collectCnt || 0, 10),
      comments: parseInt(item.interactFavorCnt || item.commentCnt || item.commentNum || 0, 10),
      reviews: parseInt(item.evaluateCnt || item.reviewCnt || 0, 10),
      price: item.soldPrice || item.minPrice || '',
      sellerName: seller.nick || '',
    };
  } catch(e) { return null; }
}

async function refreshX5sec() {
  /** 通过CDP导航到商品页刷新x5sec验证 */
  try {
    const targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json`));
    const page = targets.find(t => (t.url||'').includes('goofish.com') && !t.url.includes('g.alicdn') && !t.url.includes('xdomain'));
    if (!page) return false;
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => { ws.on('open', r); ws.on('error', r); setTimeout(r, 3000); });
    if (ws.readyState !== WebSocket.OPEN) return false;
    let id = 1; const p = new Map();
    ws.on('message', d => { try { const m = JSON.parse(d.toString()); if (m.id) { const h = p.get(m.id); if (h) { clearTimeout(h.t); p.delete(m.id); h.r(m); } } } catch(e) {} });
    const s = (m, par) => new Promise(r => { const i = id++; p.set(i, { r, t: setTimeout(() => { p.delete(i); r({}); }, 20000) }); ws.send(JSON.stringify({ id: i, method: m, params: par })); });
    await s('Network.enable'); await s('Page.enable');
    // 导航到一个商品页触发x5sec验证
    await s('Page.navigate', { url: 'https://www.goofish.com/item/1061901376412' }).catch(() => {});
    await sleep(3000);
    ws.close();
    return true;
  } catch(e) { return false; }
}

// ============================================================
//  数据存储
// ============================================================
class ShopStore {
  constructor(userId) {
    this.userId = userId;
    this.filepath = path.join(DATA_DIR, `shop_${userId}.json`);
    try { 
      this.data = JSON.parse(fs.readFileSync(this.filepath, 'utf-8')); 
      if (!this.data.previousSnapshot) this.data.previousSnapshot = [];
    } catch(e) { 
      this.data = { userId, items: {}, changes: [], previousSnapshot: [], lastUpdate: null }; 
    }
  }
  save() { fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2), 'utf-8'); }
  
  async fetchAndSync() {
    const now = new Date().toISOString();
    
    // 在同步前，先保存当前在售商品的快照
    const currentActive = Object.values(this.data.items).filter(i => i.status !== 'sold_out');
    this.data.previousSnapshot = currentActive.map(i => ({
      itemId: i.itemId, title: i.title, price: i.price, 
      status: i.status, firstSeen: i.firstSeen, lastSeen: i.lastSeen, 
      url: i.url
    }));
    
    const allCards = [];
    const seenIds = new Set();
    
    // 获取第一页并得到总商品数
    let firstPageRes;
    try {
      firstPageRes = await callMTOP('idle.web.xyh.item.list', { needGroupInfo: true, pageNumber: 1, userId: String(this.userId), pageSize: 20 }, { spm_cnt: 'a21ybx.personal.0.0' });
    } catch(e) {
      console.error('  ❌ callMTOP 第一页异常:', e.message);
      return 0;
    }
    
    if (!firstPageRes || !firstPageRes.data) {
      console.log('  ⚠️  返回空数据，停止同步');
      return 0;
    }
    
    const processCards = (data) => {
      const cards = data?.cardList || [];
      cards.forEach(c => {
        const rawId = c.cardData?.detailParams?.itemId || String(c.cardData?.id || '');
        if (rawId && !seenIds.has(rawId)) {
          seenIds.add(rawId);
          allCards.push({ _id: rawId, cardData: c.cardData });
        }
      });
    };
    
    processCards(firstPageRes.data);
    const totalCount = parseInt(firstPageRes.data.totalCount || '0', 10);
    console.log(`  该店共 ${totalCount || '?'} 个商品`);
    
    // 如果有更多页，并发请求剩余页（最多支持50页）
    const totalPages = Math.min(50, Math.ceil(totalCount / 20));
    if (totalPages > 1) {
      console.log(`  并发获取剩余 ${totalPages - 1} 页 (限制并发数: 5)...`);
      const pagesToFetch = Array.from({length: totalPages - 1}, (_, i) => i + 2);
      
      const maxConcurrent = 5;
      for (let i = 0; i < pagesToFetch.length; i += maxConcurrent) {
        const chunk = pagesToFetch.slice(i, i + maxConcurrent);
        const promises = chunk.map(p => 
          callMTOP('idle.web.xyh.item.list', { needGroupInfo: true, pageNumber: p, userId: String(this.userId), pageSize: 20 }, { spm_cnt: 'a21ybx.personal.0.0' })
          .then(r => {
            if (r && r.data) processCards(r.data);
          })
          .catch(e => {
            console.error(`  ❌ 翻页 ${p} 异常:`, e.message);
          })
        );
        await Promise.all(promises);
      }
    }
    
    console.log(`  已获取 ${allCards.length} 个商品 (${totalPages}页)`);
    const apiIds = new Set(allCards.map(c => c._id));
    
    for (const card of allCards) {
      const cd = card.cardData || {};
      const id = card._id; if (!id) continue;
      const item = { itemId: id, title: cd.title || '', price: cd.priceInfo?.price || '', image: cd.picInfo?.url || cd.detailParams?.picUrl || '', url: `https://www.goofish.com/item/${id}`, wants: 0, views: 0, favorites: 0, comments: 0, reviews: 0 };
      if (!this.data.items[id]) {
        this.data.items[id] = { ...item, firstSeen: now, lastSeen: now, checkCount: 1, status: 'active', history: [{ timestamp: now, title: item.title, price: item.price }], changes: [{ timestamp: now, type: 'NEW', message: `新商品: ${item.title}` }] };
        this.data.changes.push({ timestamp: now, itemId: id, type: 'NEW', message: item.title });
      } else {
        const ex = this.data.items[id]; ex.lastSeen = now; ex.checkCount++; ex.status = 'active';
        if (ex.title !== item.title) { const msg = `标题: "${ex.title}" → "${item.title}"`; ex.changes.push({ timestamp: now, type: 'TITLE_CHANGE', message: msg }); this.data.changes.push({ timestamp: now, itemId: id, type: 'TITLE_CHANGE', message: msg }); ex.title = item.title; }
        if (ex.price !== item.price && ex.price && item.price) { const msg = `价格: ¥${ex.price} → ¥${item.price}`; ex.changes.push({ timestamp: now, type: 'PRICE_CHANGE', message: msg }); this.data.changes.push({ timestamp: now, itemId: id, type: 'PRICE_CHANGE', message: msg }); ex.price = item.price; }
        ex.history.push({ timestamp: now, title: item.title, price: item.price });
        if (ex.history.length > 500) ex.history = ex.history.slice(-500);
      }
    }
    for (const [id, item] of Object.entries(this.data.items)) {
      if (!apiIds.has(id) && item.status === 'active' && item.checkCount > 1) {
        item.status = 'sold_out'; item.lastSeen = now; const msg = `已下架: ${item.title}`;
        item.changes.push({ timestamp: now, type: 'SOLD_OUT', message: msg }); this.data.changes.push({ timestamp: now, itemId: id, type: 'SOLD_OUT', message: msg });
      }
    }
    this.data.lastUpdate = now; this.save();
    return allCards.length;
  }
  
  async fetchAndStoreStats(itemId) {
    const d = await fetchItemStats(itemId);
    if (!d) return d;  // 即使不在存储中也返回数据
    const item = this.data.items[itemId];
    if (!item) return d;  // 商品不在当前店铺中，直接返回
    const now = new Date().toISOString();
    const dims = ['views','wants','favorites','comments','reviews'];
    for (const k of dims) {
      if (d[k] !== undefined && d[k] > 0) {
        if (item[k] !== d[k]) {
          const msg = `${k}: ${item[k]||0} → ${d[k]}`;
          item.changes.push({ timestamp: now, type: 'STATS_CHANGE', message: msg });
          this.data.changes.push({ timestamp: now, itemId, type: 'STATS_CHANGE', message: msg });
        }
        item[k] = d[k];
      }
    }
    if (d.price) item.price = d.price;
    this.save(); return d;
  }
  
  getJSON() {
    const items = Object.values(this.data.items).sort((a, b) => (b.checkCount||0) - (a.checkCount||0));
    return { 
      userId: this.userId, 
      totalItems: items.length, 
      activeItems: items.filter(i => i.status !== 'sold_out').length, 
      lastUpdate: this.data.lastUpdate, 
      changes: (this.data.changes||[]).slice(-200).reverse(), 
      previousSnapshot: this.data.previousSnapshot || [],
      items: items.map(i => ({ 
        itemId: i.itemId, title: i.title, price: i.price, 
        status: i.status, firstSeen: i.firstSeen, lastSeen: i.lastSeen, 
        checkCount: i.checkCount, url: i.url, 
        wants: i.wants||0, views: i.views||0, favorites: i.favorites||0, 
        comments: i.comments||0, reviews: i.reviews||0, 
        changes: (i.changes||[]).slice(-50),
        history: (i.history||[]).slice(-50)
      })) 
    };
  }
  
  exportCSV() {
    if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const fp = path.join(EXPORT_DIR, `闲鱼监控_${this.userId}_${new Date().toISOString().slice(0,10)}.csv`);
    const items = Object.values(this.data.items);
    const fields = ['itemId','title','price','views','wants','favorites','comments','reviews','status','firstSeen','lastSeen','checkCount','url'];
    const BOM = '\uFEFF';
    fs.writeFileSync(fp, BOM + fields.join(',') + '\n' + items.map(item => fields.map(f => `"${String(item[f]||'').replace(/"/g,'""')}"`).join(',')).join('\n'), 'utf-8');
    return fp;
  }
}

// ============================================================
//  HTML 页面
// ============================================================
const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');

// ============================================================
//  HTTP 路由
// ============================================================
function serveStatic(res, c, t='text/html') { res.writeHead(200,{'Content-Type':t+'; charset=utf-8','Access-Control-Allow-Origin':'*'}); res.end(c); }
function serveJSON(res, d, s=200) {
  if (res.headersSent || res.writableEnded) return;
  let body;
  try { body = JSON.stringify(d); } catch(e) { body = JSON.stringify({error:'serialize_failed'}); s = 500; }
  res.writeHead(s,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});
  res.end(body);
}
function serveError(res, m, s=400) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(s,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});
  res.end(JSON.stringify({error:m}));
}
function parseBody(req) { return new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b)); } catch(e) { r({}); } }); }); }

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    const url = new URL(req.url, `http://${req.headers.host}`); const path = url.pathname;
    if (path === '/' || path === '/index.html') return serveStatic(res, HTML);
    if (path === '/api/session') return serveJSON(res, { valid: _session.valid, count: _session.count||0 });
	    if (path === '/api/monitor' && req.method === 'POST') {
	      const body = await parseBody(req); const id = body.userId;
	      if (!id) return serveError(res, '需要userId');
	      // 获取session（最多重试3次）
	      let ok = _session.valid;
	      for (let i = 0; !ok && i < 3; i++) {
	        ok = await refreshSession();
	        if (!ok && i < 2) await sleep(1000);
	      }
	      if (!ok) return serveError(res, '请在Chrome窗口中登录闲鱼，然后重试', 401);
	      console.log('  📦 开始 fetchAndSync...');
	      const store = new ShopStore(id);
	      try {
	        await store.fetchAndSync();
	        console.log('  📦 fetchAndSync 完成，开始构建响应...');
	        const json = store.getJSON();
	        console.log('  📦 getJSON 完成，items:', json.items?.length, '准备发送响应...');
	        return serveJSON(res, json);
	      } catch(e) {
	        console.error('  ❌ monitor 错误:', e.message, e.stack?.slice(0,200));
	        return serveError(res, e.message, 500);
	      }
	    }
    if (path === '/api/stats' && req.method === 'POST') {
      const body = await parseBody(req); const itemId = body.itemId;
      if (!itemId) return serveError(res, '需要itemId');
      console.log(`  🔍 查询统计: ${itemId}`);
      await refreshSession();
      const store = new ShopStore(body.userId || '_tmp_');
      const detail = await store.fetchAndStoreStats(itemId);
      if (detail) {
        if (detail.x5sec_expired) {
          return serveJSON(res, { ok:false, x5sec_expired: true, message: '请在Chrome中打开任意一个商品详情页完成安全验证，然后重试' });
        }
        console.log(`     ✅ 浏览=${detail.views} 想要=${detail.wants} 收藏=${detail.favorites}`);
        return serveJSON(res, { ok:true, ...detail });
      }
      return serveJSON(res, { ok:false });
    }
    
    // 刷新 x5sec 验证（通过CDP导航到商品页）
    if (path === '/api/refresh-x5sec' && req.method === 'POST') {
      console.log('  🔄 刷新x5sec验证...');
      const ok = await refreshX5sec();
      return serveJSON(res, { ok });
    }
    if (path === '/api/data') {
      const id = url.searchParams.get('userId'); if (!id) return serveError(res, '需要userId');
      const fp = path.join(DATA_DIR, `shop_${id}.json`); if (!fs.existsSync(fp)) return serveError(res, '暂无数据');
      return serveJSON(res, new ShopStore(id).getJSON());
    }
    if (path === '/api/export') {
      const id = url.searchParams.get('userId'); if (!id) return serveError(res, '需要userId');
      const store = new ShopStore(id); const fp = store.exportCSV();
      const filename = `xianyu_${id}.csv`;
      res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename=${filename}`});
      res.end(fs.readFileSync(fp, 'utf-8')); return;
    }
    serveError(res, 'Not Found', 404);
  } catch(e) { console.error('错误:', e.message); serveError(res, e.message, 500); }
});

// ============================================================
//  工具 & 启动
// ============================================================

function httpGet(url) { return new Promise(r => { 
  const req = http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); });
  req.on('error', () => r(''));
  req.setTimeout(5000, () => { req.destroy(); r(''); });
}); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function autoLaunchChrome() {
  /** 自动找到 Chrome 并以调试模式启动 */
  // 先检查 9222 端口是否已被占用（可能是之前的 Chrome 还在运行）
  try {
    const data = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/version`);
    if (data) {
      console.log('  ✅ Chrome 已在运行（端口 9222）');
      return true;
    }
  } catch(e) {}
  
  const commonPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    'chrome',
  ];
  
  let chromePath = '';
  for (const p of commonPaths) {
    try {
      if (p === 'chrome') {
        await new Promise(r => exec('where chrome', () => r()));
        chromePath = 'chrome';
      } else if (fs.existsSync(p)) {
        chromePath = p;
      }
    } catch(e) {}
    if (chromePath) break;
  }
  
  if (!chromePath) {
    console.log('  ⚠️ 未找到 Chrome，请手动安装');
    return false;
  }
  
  // 以调试模式启动（独立 user-data-dir，登录态持久化保存）
  const chromeDataDir = path.join(__dirname, 'chrome-data');
  if (!fs.existsSync(chromeDataDir)) fs.mkdirSync(chromeDataDir, { recursive: true });
  console.log('  🚀 启动 Chrome（远程调试端口 9222）...');
  const args = [
    '--remote-debugging-port=9222',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + chromeDataDir,
    '--new-window',
    'https://www.goofish.com/'
  ];
  try {
    const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
    child.unref();
    console.log('  ⏳ 等待 Chrome 启动...');
  } catch(e) {
    console.log('  ⚠️ 启动失败:', e.message);
  }
  
  // 等待 Chrome 就绪
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    try {
      const data = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (data) { console.log('  ✅ Chrome 已就绪'); return true; }
    } catch(e) {}
  }
  console.log('  ⚠️ Chrome 启动超时');
  return false;
}

console.log('='*50); console.log('  闲鱼店铺监控 Web 服务'); console.log('='*50);
console.log(`  地址: http://localhost:${PORT}`); console.log();
console.log('  功能:');
console.log('  ✅ 商品列表 + 上新/下架/标题/价格检测');
console.log('  ✅ 5维数据查询（浏览/想要/收藏/留言/评价）');
console.log('  ✅ CSV导出');
console.log(); console.log('  打开浏览器访问 http://localhost:3000'); console.log('='*50);

setTimeout(async () => {
  // 自动启动 Chrome（如果未运行）
  await autoLaunchChrome();
  // 等几秒让 Chrome 加载
  await sleep(5000);
  const ok = await refreshSession();
  if (ok) {
    console.log('  登录: ✅ 已登录');
  } else {
    console.log('  登录: ❌ 未登录');
    console.log('  ⚠️ 请在新打开的 Chrome 窗口中登录闲鱼');
    console.log('  然后刷新 http://localhost:3000 即可使用');
  }
  console.log('='*50);
}, 500);

// 全局异常兜底：防止 socket write after end 等错误杀死进程
process.on('uncaughtException', (err) => {
  console.error('  ⚠️ uncaughtException (已捕获，进程继续):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('  ⚠️ unhandledRejection (已捕获，进程继续):', reason?.message || reason);
});

server.listen(PORT);
