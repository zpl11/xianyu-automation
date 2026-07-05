/**
 * 闲鱼店铺监控系统 v2.0
 * =====================
 * 使用 CDP Network API 直接拦截所有网络请求和响应体。
 * 不需要注入JavaScript，完全依赖Chrome DevTools Protocol。
 * 
 * 用法:
 *   node shop_monitor_v2.mjs --userId=4252893945
 */

import WebSocket from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const CDP_PORT = 9222;
const DATA_FILE = 'shop_monitor_data.json';
const EXPORT_DIR = 'exports';

// ============================================================
//  工具函数
// ============================================================

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function now() {
  return new Date().toISOString();
}

// ============================================================
//  CDP 客户端
// ============================================================

class CDPClient {
  constructor() {
    this.ws = null;
    this._pending = new Map();
    this._cmdId = 1;
    this.networkEvents = [];
    this.responseBodies = new Map();  // requestId -> body
    this.capturedApis = [];           // 成功解析的API
    
    // 需要捕获的API模式
    this.targetApiPatterns = [
      'pc.detail', 'pc.search', 'home.webpc.feed',
      'user.page', 'seller', 'item',
    ];
  }
  
  async connect() {
    // 创建新页面
    const pageInfo = await new Promise((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${CDP_PORT}/json/new?about:blank`,
        { method: 'PUT' }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error(`创建页面失败: ${data.slice(0, 100)}`)); }
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
    
    this.targetId = pageInfo.id;
    log(`📄 新页面: ${this.targetId}`);
    
    // 连接WebSocket
    this.ws = await new Promise((resolve, reject) => {
      const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
      setTimeout(() => reject(new Error('WS超时')), 10000);
    });
    
    log('🔗 WebSocket已连接');
    
    // 消息处理器
    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        // 命令响应
        if (msg.id !== undefined) {
          const handler = this._pending.get(msg.id);
          if (handler) {
            clearTimeout(handler.timeout);
            this._pending.delete(msg.id);
            if (msg.error) handler.reject(new Error(JSON.stringify(msg.error)));
            else handler.resolve(msg);
          }
          return;
        }
        
        // 事件通知
        if (msg.method) {
          this._handleEvent(msg);
        }
      } catch (e) {
        // 忽略
      }
    });
    
    // 启用域
    await this._send('Page.enable');
    await this._send('Network.enable');
    log('✅ CDP就绪');
  }
  
  _send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this._cmdId++;
      const timeout = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`超时: ${method}`));
      }, 15000);
      this._pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  
  _handleEvent(msg) {
    const { method, params } = msg;
    
    // 响应接收事件 - 保存requestId以便获取响应体
    if (method === 'Network.responseReceived') {
      const url = params.response?.url || '';
      if (url.includes('h5api.m.goofish.com/h5/mtop.')) {
        const requestId = params.requestId;
        const apiName = url.match(/mtop\.[^/?]+/)?.[0] || '';
        this._pendingResponses = this._pendingResponses || [];
        this._pendingResponses.push({ requestId, apiName, url });
        log(`📥 [API] ${apiName}`);
      }
    }
    
    // 页面加载完成 - 获取所有等待的API响应体
    if (method === 'Page.frameStoppedLoading') {
      log('📄 页面加载完成，获取API响应体...');
      this._fetchPendingResponses();
    }
    
    // 页面加载完成事件
    if (method === 'Page.frameStoppedLoading') {
      log('📄 页面加载完成');
    }
  }
  
  async navigate(url) {
    log(`🌐 导航: ${url.slice(0, 80)}`);
    try {
      await this._send('Page.navigate', { url });
    } catch (e) {
      log(`⚠️ 导航超时`);
    }
    await sleep(5000);
  }
  
  async scroll() {
    try {
      await this._send('Runtime.evaluate', {
        expression: 'window.scrollBy(0, 1200)',
      });
    } catch (e) {}
  }
  
  async _fetchPendingResponses() {
    /** 获取所有等待的API响应体并解析 */
    const pending = this._pendingResponses || [];
    this._pendingResponses = [];
    
    if (pending.length === 0) return;
    
    for (const p of pending) {
      try {
        const result = await this._send('Network.getResponseBody', { requestId: p.requestId });
        const body = result.result?.body || '';
        const isBase64 = result.result?.base64Encoded || false;
        
        let text = body;
        if (isBase64) text = Buffer.from(body, 'base64').toString();
        
        // 解析MTOP
        const match = text.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
        let parsed = null;
        if (match) { try { parsed = JSON.parse(match[1]); } catch (e) {} }
        else { try { parsed = JSON.parse(text); } catch (e) {} }
        
        if (parsed && parsed.api) {
          this.capturedApis.push(parsed);
        }
      } catch (e) {
        // 忽略获取失败
      }
    }
    
    log(`  ✅ 已解析 ${pending.length} 个API响应 (累计: ${this.capturedApis.length})`);
  }
  
  close() {
    if (this.ws) this.ws.close();
  }
}

// ============================================================
//  数据解析
// ============================================================

function extractItemDetail(parsed) {
  const data = parsed?.data;
  if (!data) return null;
  
  const item = data.itemDO || data.item || {};
  const seller = data.sellerDO || {};
  
  const itemId = String(item.itemId || '');
  if (!itemId) return null;
  
  return {
    itemId,
    title: (item.title || '').trim(),
    price: item.soldPrice || item.minPrice || '',
    views: parseInt(item.browseCnt || 0, 10),
    wants: parseInt(item.wantCnt || 0, 10),
    favorites: parseInt(item.collectCnt || 0, 10),
    comments: parseInt(item.interactFavorCnt || 0, 10),
    reviews: parseInt(item.evaluateCnt || 0, 10),
    pubTime: item.gmtCreate || '',
    sellerId: String(seller.sellerId || ''),
    sellerName: seller.nick || '',
    sellerItems: seller.sellerItems || [],
  };
}

function extractSearchItems(parsed) {
  const data = parsed?.data;
  if (!data) return [];
  
  const apiName = parsed.api || '';
  const items = [];
  
  // xyh.item.list 格式：
  //   cardList[].cardData - 商品卡片数据
  //     cardData.id         - 商品ID
  //     cardData.detailUrl  - 商品详情URL
  //     cardData.priceInfo  - 价格信息
  //     cardData.picInfo    - 图片信息
  //     cardData.itemStatus - 商品状态
  if (apiName.includes('xyh.item.list')) {
    // 从 cardList[].cardData 提取
    const cardList = data.cardList || [];
    for (const card of cardList) {
      const cd = card.cardData || card.data || card;
      const itemId = String(cd.id || cd.itemId || cd.item_id || '');
      if (itemId) {
        // 从 detailUrl 提取标题 - URL末尾通常会编码商品名
        let title = cd.title || '';
        if (!title && cd.detailUrl) {
          title = decodeURIComponent(cd.detailUrl.split('/').pop() || '').replace(/_/g, ' ');
        }
        
        // 从 priceInfo 提取价格
        let price = '';
        if (cd.priceInfo) {
          price = cd.priceInfo.price || cd.priceInfo.soldPrice || 
                  cd.priceInfo.reservePrice || cd.priceInfo.minPrice || '';
        }
        
        // 从 picInfo 提取图片
        let image = '';
        if (cd.picInfo) {
          image = cd.picInfo.url || cd.picInfo.mainPic || cd.picInfo.thumbUrl || '';
        }
        
        items.push({
          itemId,
          title: title || '',
          price: String(price),
          wants: 0,
          views: 0,
          favorites: 0,
          image,
        });
      }
    }
    
    log(`  从 xyh.item.list 提取到 ${items.length} 个商品 (cardList=${cardList.length}, totalCount=${data.totalCount})`);
    return items;
  }
  
  // 搜索结果格式：resultList[].data.item.main
  const list = data.resultList || data.cardList || [];
  
  for (const item of list) {
    const main = item?.data?.item?.main || item?.main || item || {};
    const args = main.clickParam?.args || main.args || {};
    const ex = main.exContent || {};
    
    let title = '';
    if (ex.richTitle) {
      title = ex.richTitle.map(t => t?.data?.text || '').join('');
    }
    
    const itemId = String(args.id || args.item_id || item.itemId || item.id || '');
    if (itemId) {
      items.push({
        itemId,
        title: title || args.title || '',
        price: args.price || args.displayPrice || '',
        wants: parseInt(args.wantNum || 0, 10),
        views: parseInt(args.browseCnt || args.viewCount || 0, 10),
        favorites: parseInt(args.collectNum || 0, 10),
      });
    }
  }
  
  return items;
}

// ============================================================
//  数据存储
// ============================================================

class DataStore {
  constructor(filepath) {
    this.filepath = filepath;
    this.data = this._load();
  }
  
  _load() {
    try {
      if (fs.existsSync(this.filepath)) {
        return JSON.parse(fs.readFileSync(this.filepath, 'utf-8'));
      }
    } catch (e) {}
    return { items: {}, changes: [], config: {} };
  }
  
  save() {
    const dir = path.dirname(this.filepath);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2), 'utf-8');
  }
  
  updateItem(data) {
    const id = data.itemId;
    if (!id) return;
    
    const ts = now();
    const existing = this.data.items[id];
    
    if (!existing) {
      this.data.items[id] = {
        itemId: id, title: data.title || '', price: data.price || '',
        url: `https://www.goofish.com/item/${id}`,
        sellerId: data.sellerId || '', sellerName: data.sellerName || '',
        firstSeen: now, lastSeen: now, checkCount: 0,
        views: data.views || 0, wants: data.wants || 0,
        favorites: data.favorites || 0, comments: data.comments || 0,
        reviews: data.reviews || 0,
        history: [], changes: [{ timestamp: now, type: 'NEW', message: '新商品上架' }],
      };
      this.data.changes.push({ timestamp: now, itemId: id, type: 'NEW', message: '新商品上架' });
      log(`🆕 新商品: ${(data.title || '').slice(0, 40)}`);
      this.save();
      return;
    }
    
    // 检测变更
    existing.lastSeen = now;
    existing.checkCount++;
    
    for (const field of ['title', 'price']) {
      if (data[field] && existing[field] !== data[field]) {
        const msg = `${field === 'title' ? '标题' : '价格'}变更: "${existing[field]}" → "${data[field]}"`;
        existing.changes.push({ timestamp: now, type: field === 'title' ? 'TITLE_CHANGE' : 'PRICE_CHANGE', message: msg });
        this.data.changes.push({ timestamp: now, itemId: id, type: field === 'title' ? 'TITLE_CHANGE' : 'PRICE_CHANGE', message: msg });
        log(`📝 ${msg}`);
        existing[field] = data[field];
      }
    }
    
    // 5维数据
    const dims = ['views', 'wants', 'favorites', 'comments', 'reviews'];
    const historyEntry = { timestamp: now, title: existing.title, price: existing.price };
    for (const dim of dims) {
      if (data[dim] !== undefined) {
        const oldVal = existing[dim];
        historyEntry[dim] = data[dim];
        if (oldVal !== undefined && oldVal !== data[dim]) {
          const msg = `${dim}: ${oldVal} → ${data[dim]}`;
          existing.changes.push({ timestamp: now, type: 'STATS_CHANGE', message: msg });
          this.data.changes.push({ timestamp: now, itemId: id, type: 'STATS_CHANGE', message: msg });
        }
        existing[dim] = data[dim];
      }
    }
    existing.history.push(historyEntry);
    
    if (existing.history.length > 500) existing.history = existing.history.slice(-500);
    this.save();
  }
  
  exportCSV(filepath) {
    const dir = path.dirname(filepath);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const fields = ['itemId', 'title', 'price', 'views', 'wants', 'favorites', 
                    'comments', 'reviews', 'sellerName', 'firstSeen', 'lastSeen', 
                    'checkCount', 'url'];
    
    const header = fields.join(',') + '\n';
    const rows = Object.values(this.data.items).map(item =>
      fields.map(f => `"${String(item[f] || '').replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    fs.writeFileSync(filepath, '\uFEFF' + header + rows, 'utf-8');
    log(`📤 已导出 ${Object.keys(this.data.items).length} 条: ${filepath}`);
  }
  
  exportJSON(filepath) {
    const dir = path.dirname(filepath);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const exportData = Object.values(this.data.items).map(item => ({
      itemId: item.itemId, title: item.title, price: item.price,
      views: item.views || 0, wants: item.wants || 0,
      favorites: item.favorites || 0, comments: item.comments || 0,
      reviews: item.reviews || 0, sellerName: item.sellerName || '',
      url: item.url, firstSeen: item.firstSeen, lastSeen: item.lastSeen,
      checkCount: item.checkCount,
    }));
    
    fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2), 'utf-8');
    log(`📤 已导出 ${exportData.length} 条: ${filepath}`);
  }
  
  printReport() {
    const items = Object.values(this.data.items);
    const active = items.filter(i => i.status !== 'sold_out');
    
    console.log('\n' + '=' * 60);
    console.log('  📊 闲鱼店铺监控报告');
    console.log(`  ${new Date().toLocaleString()}`);
    console.log('=' * 60);
    console.log(`  店铺: ${items[0]?.sellerName || '?'}`);
    console.log(`  追踪商品: ${items.length}`);
    console.log(`  活跃: ${active.length} | 已下架: ${items.length - active.length}`);
    console.log(`  变更事件: ${this.data.changes.length}`);
    console.log();
    
    // TOP 10
    console.log('  🔥 热门商品 TOP 10');
    const sorted = active.sort((a, b) => (b.views || 0) - (a.views || 0));
    sorted.slice(0, 10).forEach((item, i) => {
      console.log(`  ${i+1}. ${(item.title || '?').slice(0, 25).padEnd(25)} 👁${item.views || 0} ❤️${item.wants || 0} ⭐${item.favorites || 0}`);
    });
    
    // 统计
    console.log('\n  📈 统计');
    const tv = active.reduce((s, i) => s + (i.views || 0), 0);
    const tw = active.reduce((s, i) => s + (i.wants || 0), 0);
    console.log(`  总浏览: ${tv} | 总想要: ${tw}`);
    console.log(`  平均浏览: ${active.length ? Math.round(tv/active.length) : 0}`);
    
    // 最近变更
    const recent = this.data.changes.slice(-5).reverse();
    if (recent.length) {
      console.log('\n  📝 最近变更');
      recent.forEach(c => {
        const title = (items.find(i => i.itemId === c.itemId)?.title || '').slice(0, 20);
        console.log(`  [${(c.timestamp || '').slice(11, 19)}] ${title} - ${c.message}`);
      });
    }
    console.log('=' * 60 + '\n');
  }
}

// ============================================================
//  主流程
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const userId = args.find(a => a.startsWith('--userId='))?.split('=')[1] || '4252893945';
  
  console.log('=' * 60);
  console.log('  闲鱼店铺监控系统 v2.0 (CDP Network API)');
  console.log('=' * 60);
  console.log(`  店铺ID: ${userId}`);
  console.log();
  
  const cdp = new CDPClient();
  const store = new DataStore(DATA_FILE);
  
  try {
    // 1. 连接
    await cdp.connect();
    
    // 2. 访问商品详情页（先获取一个已知商品的详情，从而得到sellerItems）
    log('\n📌 步骤1: 访问商品详情页...');
    
    // 使用已导出的商品ID（从之前的数据中获取）
    const knownItems = ['1059354152213', '1059012442631'];
    let allItemIds = new Set();
    let sellerName = '';
    
    for (const itemId of knownItems) {
      await cdp.navigate(`https://www.goofish.com/item/${itemId}`);
      
      // 处理已捕获的API
      for (const parsed of cdp.capturedApis) {
        const detail = extractItemDetail(parsed);
        if (detail) {
          store.updateItem(detail);
          allItemIds.add(detail.itemId);
          if (detail.sellerName) sellerName = detail.sellerName;
          
          // sellerItems - 店铺所有商品！
          if (detail.sellerItems && Array.isArray(detail.sellerItems)) {
            log(`  从详情页获取到 ${detail.sellerItems.length} 个店铺商品`);
            for (const si of detail.sellerItems) {
              const sid = String(si.itemId || '');
              if (sid) {
                allItemIds.add(sid);
                store.updateItem({
                  itemId: sid,
                  title: si.title || '',
                  price: si.price || '',
                  sellerName: detail.sellerName,
                  sellerId: detail.sellerId,
                });
              }
            }
          }
        }
      }
      
      // 只访问第一个已知商品
      if (allItemIds.size > 0) break;
    }
    
    log(`\n📋 发现 ${allItemIds.size} 个商品`);
    
    // 3. 访问店铺页
    if (userId) {
      log('\n📌 步骤2: 访问店铺页...');
      await cdp.navigate(`https://www.goofish.com/personal?userId=${userId}`);
      
      // 滚动加载
      for (let i = 0; i < 3; i++) {
        await cdp.scroll();
        await sleep(1500);
      }
      
      // 从搜索/列表API中提取商品
      for (const parsed of cdp.capturedApis) {
        const items = extractSearchItems(parsed);
        for (const item of items) {
          if (item.itemId && !allItemIds.has(item.itemId)) {
            allItemIds.add(item.itemId);
            log(`  新增: ${item.title.slice(0, 30)}`);
            store.updateItem(item);
          }
        }
      }
      
      log(`\n📋 总共 ${allItemIds.size} 个商品`);
    }
    
    // 4. 采集5维数据
    log('\n📌 步骤3: 采集商品详情数据...');
    const storedIds = Object.keys(store.data.items);
    let collected = 0;
    
    for (const itemId of storedIds.slice(0, 20)) {
      await cdp.navigate(`https://www.goofish.com/item/${itemId}`);
      
      for (const parsed of cdp.capturedApis) {
        const detail = extractItemDetail(parsed);
        if (detail && detail.itemId === itemId) {
          store.updateItem(detail);
          collected++;
          log(`  📊 ${detail.title.slice(0, 25)} | 浏览=${detail.views} 想要=${detail.wants}`);
          break;
        }
      }
      
      await sleep(1000);
    }
    
    log(`\n✅ 成功采集 ${collected} 个商品详情`);
    
    // 5. 导出
    log('\n📌 步骤4: 导出数据...');
    const dateStr = now().replace(/[:]/g, '-');
    store.exportCSV(path.join(EXPORT_DIR, `店铺监控_${dateStr}.csv`));
    store.exportJSON(path.join(EXPORT_DIR, `店铺监控_${dateStr}.json`));
    store.printReport();
    
  } catch (e) {
    console.error('❌ 错误:', e.message);
    console.error(e.stack);
  } finally {
    cdp.close();
  }
}

main();
