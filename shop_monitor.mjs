/**
 * 闲鱼店铺监控系统 v1.0
 * =====================
 * 通过 CDP 连接到运行中的 Chrome，监控指定店铺的所有商品变动。
 * 
 * 原理：
 *   1. 注入 JavaScript 拦截 fetch/XHR，捕获 MTOP API 响应
 *   2. 访问商品详情页 → 获取 5维数据 + sellerItems（店铺所有商品）
 *   3. 周期性检查 → 检测上新/下架/标题变更/数据变动
 *   4. 导出 CSV/JSON 报告
 * 
 * 用法：
 *   node shop_monitor.mjs --userId=4252893945              # 监控指定店铺
 *   node shop_monitor.mjs --userId=4252893945 --interval=5  # 每5分钟检查
 *   node shop_monitor.mjs --export                         # 导出数据
 *   node shop_monitor.mjs --report                         # 统计报告
 * 
 * 依赖: npm install ws
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

// ============================================================
//  配置
// ============================================================
const CDP_PORT = 9222;
const CONFIG = {
  dataFile: 'shop_monitor_data.json',
  exportDir: 'exports',
  checkInterval: 300,        // 默认检查间隔（秒）
  maxItems: 200,             // 最大追踪商品数
};

// ============================================================
//  工具函数
// ============================================================

function log(msg, level = 'INFO') {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${level}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function now() {
  return new Date().toISOString();
}

// ============================================================
//  CDP 连接
// ============================================================

async function getCDPTarget(preferId) {
  // 使用 http 模块获取 CDP target 列表（兼容性更好）
  const http = await import('http');
  
  const targets = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`解析CDP响应失败: ${data.slice(0, 100)}`)); }
      });
    }).on('error', reject);
  });
  
  // 寻找已打开闲鱼页面的target
  const xianyuTargets = targets.filter(t => 
    (t.url || '').includes('goofish.com') || 
    (t.title || '').includes('闲鱼')
  );
  
  if (xianyuTargets.length > 0) {
    log(`找到 ${xianyuTargets.length} 个闲鱼页面`);
    for (const t of xianyuTargets) {
      log(`  📄 ${t.title || '?'}`);
    }
    // 使用第一个闲鱼页面
    return xianyuTargets[0];
  }
  
  // 返回第一个非特殊页面
  const normalPage = targets.find(t => 
    t.url && !t.url.startsWith('devtools://') && 
    !t.url.startsWith('chrome://') && 
    !t.url.startsWith('about:')
  );
  return normalPage || targets[0];
}

async function connectCDP() {
  // 使用 /json/new 创建新页面
  const http = await import('http');
  
  const newTarget = await new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, {
      method: 'PUT',
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`创建页面失败: ${data.slice(0, 100)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
  
  const targetId = newTarget.id;
  const pageWsUrl = newTarget.webSocketDebuggerUrl;
  log(`✅ 创建新页面: ${targetId}`);
  log(`🔗 页面WS: ${pageWsUrl.slice(0, 80)}`);
  
  // 连接到页面WebSocket
  const pageWs = await new Promise((resolve, reject) => {
    const ws = new WebSocket(pageWsUrl);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(new Error(`WS错误: ${err.message}`)));
    setTimeout(() => reject(new Error('页面连接超时')), 10000);
  });
  
  log('✅ 已连接到页面');
  return { pageWs, targetId };
}

// CDP 消息路由器
const cdpHandlers = new Map();

function setupCDPHandler(ws) {
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id !== undefined) {
        const handler = cdpHandlers.get(msg.id);
        if (handler) {
          cdpHandlers.delete(msg.id);
          if (msg.error) {
            handler.reject(new Error(`CDP错误: ${JSON.stringify(msg.error)}`));
          } else {
            handler.resolve(msg);
          }
        }
      } else if (msg.method) {
        // 事件通知，忽略
      }
    } catch (e) {
      // 忽略解析错误
    }
  });
}

function sendCDP(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) {
      return reject(new Error(`WebSocket未连接 (state=${ws.readyState})`));
    }
    
    const id = Date.now() + Math.random();
    cdpHandlers.set(id, { resolve, reject });
    
    ws.send(JSON.stringify({ id, method, params }));
    
    setTimeout(() => {
      if (cdpHandlers.has(id)) {
        cdpHandlers.delete(id);
        reject(new Error(`CDP请求超时: ${method}`));
      }
    }, 15000);
  });
}

// ============================================================
//  注入拦截脚本
// ============================================================

function getInterceptorScript() {
  return `
    // ===== 闲鱼API拦截器 =====
    (function() {
      if (window.__xianyuInterceptorInjected) return;
      window.__xianyuInterceptorInjected = true;
      window.__xianyuCaptured = [];
      
      const TARGET_DOMAINS = ['h5api.m.goofish.com', 'api.m.goofish.com'];
      
      function isTarget(url) {
        return TARGET_DOMAINS.some(d => url.includes(d));
      }
      
      function capture(apiName, data) {
        if (apiName) {
          window.__xianyuCaptured.push({
            api: apiName,
            data: data,
            time: Date.now()
          });
        }
      }
      
      // 拦截 fetch
      const origFetch = window.fetch;
      window.fetch = async function(url, opts) {
        const resp = await origFetch.apply(this, arguments);
        if (typeof url === 'string' && isTarget(url)) {
          try {
            const clone = resp.clone();
            const text = await clone.text();
            const match = text.match(/^\\s*mtopjsonp\\d+\\s*\\((.*)\\)\\s*;?\\s*$/);
            if (match) {
              try {
                const json = JSON.parse(match[1]);
                capture(json.api, json);
              } catch(e) {}
            }
          } catch(e) {}
        }
        return resp;
      };
      
      // 拦截 XHR
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      
      XMLHttpRequest.prototype.open = function(method, url) {
        this._xianyuUrl = url;
        return origOpen.apply(this, arguments);
      };
      
      XMLHttpRequest.prototype.send = function(body) {
        if (this._xianyuUrl && isTarget(this._xianyuUrl)) {
          this.addEventListener('load', function() {
            try {
              const text = this.responseText;
              const match = text.match(/^\\s*mtopjsonp\\d+\\s*\\((.*)\\)\\s*;?\\s*$/);
              if (match) {
                try {
                  const json = JSON.parse(match[1]);
                  capture(json.api, json);
                } catch(e) {}
              }
            } catch(e) {}
          });
        }
        return origSend.apply(this, arguments);
      };
      
      console.log('[Xianyu Monitor] API拦截器已注入');
    })();
  `;
}

// ============================================================
//  数据解析
// ============================================================

function parseItemDetail(data) {
  /** 从 detail API 响应中提取商品数据 */
  if (!data || !data.data) return null;
  
  const apiData = data.data;
  const item = apiData.itemDO || apiData.item || {};
  const seller = apiData.sellerDO || {};
  if (!item.itemId) return null;
  
  return {
    itemId: String(item.itemId),
    title: (item.title || '').trim(),
    price: item.soldPrice || item.minPrice || item.price || '',
    views: parseInt(item.browseCnt || 0, 10),
    wants: parseInt(item.wantCnt || 0, 10),
    favorites: parseInt(item.collectCnt || 0, 10),
    comments: parseInt(item.interactFavorCnt || 0, 10),
    reviews: parseInt(item.evaluateCnt || 0, 10),
    pubTime: item.gmtCreate || item.publishTime || '',
    sellerId: String(seller.sellerId || ''),
    sellerName: seller.nick || '',
    location: seller.city || '',
    sellerItems: seller.sellerItems || [],  // 店铺所有商品列表！
  };
}

function parseSearchResult(data) {
  /** 从 search API 响应中提取商品列表 */
  if (!data || !data.data) return [];
  
  const list = data.data.resultList || data.data.cardList || [];
  return list.map(item => {
    const main = item?.data?.item?.main || item?.main || {};
    const args = main.clickParam?.args || main.args || {};
    const ex = main.exContent || {};
    
    let title = '';
    if (ex.richTitle) {
      title = ex.richTitle.map(t => t?.data?.text || '').join('');
    }
    
    return {
      itemId: String(args.id || args.item_id || item.itemId || item.id || ''),
      title: title || args.title || item.title || '',
      price: args.price || args.displayPrice || item.price || '',
      wants: parseInt(args.wantNum || item.wantCnt || 0, 10),
      views: parseInt(args.browseCnt || args.viewCount || item.browseCnt || 0, 10),
      favorites: parseInt(args.collectNum || item.collectCnt || 0, 10),
    };
  }).filter(i => i.itemId);
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
    } catch (e) {
      log(`数据文件损坏，重新创建: ${e.message}`, 'WARN');
    }
    return { items: {}, changes: [], config: {} };
  }
  
  save() {
    const dir = path.dirname(this.filepath);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2), 'utf-8');
  }
  
  updateItem(itemData) {
    /** 更新商品数据，检测变更 */
    const id = itemData.itemId;
    if (!id) return;
    
    const now = now();
    const item = this.data.items[id];
    
    if (!item) {
      // 新商品
      this.data.items[id] = {
        itemId: id,
        title: itemData.title || '',
        price: itemData.price || '',
        url: `https://www.goofish.com/item/${id}`,
        sellerId: itemData.sellerId || '',
        sellerName: itemData.sellerName || '',
        firstSeen: now,
        lastSeen: now,
        checkCount: 0,
        history: [],
        changes: [{ timestamp: now, type: 'NEW', message: '新商品上架' }],
      };
      this.data.changes.push({ timestamp: now, itemId: id, type: 'NEW', message: '新商品上架' });
      log(`🆕 新商品: ${(itemData.title || '').slice(0, 40)}`);
    }
    
    const existing = this.data.items[id];
    existing.lastSeen = now;
    existing.checkCount++;
    
    // 检测标题变更
    if (existing.title && itemData.title && existing.title !== itemData.title) {
      const msg = `标题变更: "${existing.title.slice(0, 20)}" → "${itemData.title.slice(0, 20)}"`;
      existing.changes.push({ timestamp: now, type: 'TITLE_CHANGE', message: msg });
      this.data.changes.push({ timestamp: now, itemId: id, type: 'TITLE_CHANGE', message: msg });
      log(`📝 ${msg}`);
    }
    
    // 检测价格变更
    if (existing.price && itemData.price && existing.price !== itemData.price) {
      const msg = `价格变更: ${existing.price} → ${itemData.price}`;
      existing.changes.push({ timestamp: now, type: 'PRICE_CHANGE', message: msg });
      this.data.changes.push({ timestamp: now, itemId: id, type: 'PRICE_CHANGE', message: msg });
      log(`💰 ${msg}`);
    }
    
    // 更新字段
    if (itemData.title) existing.title = itemData.title;
    if (itemData.price) existing.price = itemData.price;
    if (itemData.sellerName) existing.sellerName = itemData.sellerName;
    if (itemData.location) existing.location = itemData.location;
    
    // 记录历史 + 检测5维数据变更
    const historyEntry = {
      timestamp: now,
      title: itemData.title || existing.title,
      price: itemData.price || existing.price,
    };
    
    for (const dim of ['views', 'wants', 'favorites', 'comments', 'reviews']) {
      if (itemData[dim] !== undefined) {
        const oldVal = existing[dim];
        historyEntry[dim] = itemData[dim];
        existing[dim] = itemData[dim];
        
        if (oldVal !== undefined && oldVal !== itemData[dim]) {
          const msg = `${dim}: ${oldVal} → ${itemData[dim]}`;
          existing.changes.push({ timestamp: now, type: 'STATS_CHANGE', message: msg });
          this.data.changes.push({ timestamp: now, itemId: id, type: 'STATS_CHANGE', message: msg });
        }
      }
    }
    
    existing.history.push(historyEntry);
    
    // 限制历史记录
    if (existing.history.length > 500) {
      existing.history = existing.history.slice(-500);
    }
    
    this.save();
  }
  
  removeItem(itemId) {
    /** 标记商品为已下架 */
    const item = this.data.items[itemId];
    if (item) {
      item.status = 'sold_out';
      item.lastSeen = now();
      const msg = `商品已下架: ${(item.title || '').slice(0, 30)}`;
      item.changes.push({ timestamp: now(), type: 'SOLD_OUT', message: msg });
      this.data.changes.push({ timestamp: now(), itemId, type: 'SOLD_OUT', message: msg });
      log(`🚫 ${msg}`);
      this.save();
    }
  }
  
  exportCSV(filepath) {
    const dir = path.dirname(filepath);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const fields = ['itemId', 'title', 'price', 'views', 'wants', 'favorites', 
                    'comments', 'reviews', 'sellerName', 'firstSeen', 'lastSeen', 
                    'checkCount', 'url', 'status'];
    
    const header = fields.join(',') + '\n';
    const rows = Object.values(this.data.items).map(item => {
      return fields.map(f => {
        const val = item[f] !== undefined ? String(item[f]) : '';
        return `"${val.replace(/"/g, '""')}"`;
      }).join(',');
    }).join('\n');
    
    fs.writeFileSync(filepath, '\uFEFF' + header + rows, 'utf-8');
    log(`📤 已导出 ${Object.keys(this.data.items).length} 条数据: ${filepath}`);
  }
  
  exportJSON(filepath) {
    const dir = path.dirname(filepath);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const exportData = Object.values(this.data.items).map(item => ({
      itemId: item.itemId,
      title: item.title,
      price: item.price,
      views: item.views || 0,
      wants: item.wants || 0,
      favorites: item.favorites || 0,
      comments: item.comments || 0,
      reviews: item.reviews || 0,
      sellerName: item.sellerName || '',
      url: item.url,
      status: item.status || 'active',
      firstSeen: item.firstSeen,
      lastSeen: item.lastSeen,
      checkCount: item.checkCount,
      history: (item.history || []).slice(-50),
    }));
    
    fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2), 'utf-8');
    log(`📤 已导出 ${exportData.length} 条数据: ${filepath}`);
  }
  
  printReport() {
    const items = Object.values(this.data.items);
    const changes = this.data.changes;
    
    console.log('\n' + '=' * 60);
    console.log('  📊 闲鱼店铺监控报告');
    console.log(`  ${new Date().toLocaleString()}`);
    console.log('=' * 60);
    console.log(`  店铺: ${items[0]?.sellerName || '?'}`);
    console.log(`  追踪商品: ${items.length}`);
    console.log(`  活跃商品: ${items.filter(i => i.status !== 'sold_out').length}`);
    console.log(`  已下架: ${items.filter(i => i.status === 'sold_out').length}`);
    console.log(`  变更事件: ${changes.length}`);
    console.log();
    
    // TOP 10
    console.log('  🔥 热门商品 TOP 10');
    console.log(`  ${'#'.padStart(3)} ${'标题'.padEnd(30)} ${'浏览'.padStart(6)} ${'想要'.padStart(6)} ${'收藏'.padStart(6)}`);
    console.log('  ' + '-'.repeat(55));
    
    const sorted = items
      .filter(i => i.status !== 'sold_out')
      .sort((a, b) => (b.views || 0) - (a.views || 0));
    
    sorted.slice(0, 10).forEach((item, i) => {
      const title = (item.title || '?').slice(0, 28).padEnd(28);
      console.log(`  ${String(i+1).padStart(3)} ${title} ${String(item.views || 0).padStart(6)} ${String(item.wants || 0).padStart(6)} ${String(item.favorites || 0).padStart(6)}`);
    });
    
    console.log();
    
    // 最近变更
    const recentChanges = changes.slice(-10).reverse();
    if (recentChanges.length > 0) {
      console.log('  📝 最近变更');
      for (const c of recentChanges) {
        const ts = (c.timestamp || '').slice(11, 19);
        const item = items.find(i => i.itemId === c.itemId);
        const title = (item?.title || c.itemId || '?').slice(0, 25);
        console.log(`  [${ts}] [${c.type.padEnd(12)}] ${title} - ${c.message}`);
      }
    }
    
    // 统计摘要
    const activeItems = items.filter(i => i.status !== 'sold_out');
    console.log('\n  📈 统计摘要');
    const totalViews = activeItems.reduce((s, i) => s + (i.views || 0), 0);
    const totalWants = activeItems.reduce((s, i) => s + (i.wants || 0), 0);
    console.log(`  活跃商品: ${activeItems.length}`);
    console.log(`  总浏览: ${totalViews.toLocaleString()}`);
    console.log(`  总想要: ${totalWants.toLocaleString()}`);
    console.log(`  平均浏览: ${activeItems.length ? Math.round(totalViews / activeItems.length).toLocaleString() : 0}`);
    console.log(`  平均想要: ${activeItems.length ? Math.round(totalWants / activeItems.length).toLocaleString() : 0}`);
    
    const changeTypes = {};
    changes.forEach(c => { changeTypes[c.type] = (changeTypes[c.type] || 0) + 1; });
    console.log(`  变更统计: ${JSON.stringify(changeTypes)}`);
    console.log('=' * 60 + '\n');
  }
}

// ============================================================
//  监控核心
// ============================================================

class ShopMonitor {
  constructor(userId, dataStore) {
    this.userId = userId;
    this.store = dataStore;
    this.ws = null;
    this.capturedApis = [];
    this.isCollecting = false;
  }
  
  async connect() {
    /** 连接到 Chrome CDP */
    log('🔌 连接到 Chrome...');
    const { pageWs, targetId } = await connectCDP();
    this.ws = pageWs;
    
    log(`⚡ WS状态: ${pageWs.readyState}`);
    
    // ===== CDP 通信 =====
    this._pendingCommands = new Map();
    
    this.ws.on('message', (data) => {
      try {
        const raw = data.toString();
        log(`📩 原始消息: ${raw.slice(0, 200)}`);
        const msg = JSON.parse(raw);
        if (msg.id !== undefined) {
          const handler = this._pendingCommands.get(msg.id);
          if (handler) {
            clearTimeout(handler.timeout);
            this._pendingCommands.delete(msg.id);
            if (msg.error) {
              handler.reject(new Error(JSON.stringify(msg.error)));
            } else {
              handler.resolve(msg);
            }
          } else {
            log(`⚠️ 未找到id=${msg.id}的处理器`, 'WARN');
          }
        }
      } catch (e) {
        log(`❌ 消息解析失败: ${e.message}`, 'ERROR');
      }
    });
    
    // 简化版 sendCDP - 用递增整数ID (Chrome要求整数id)
    let cmdId = 1;
    const _send = (method, params = {}) => {
      return new Promise((resolve, reject) => {
        const id = cmdId++;
        const timeout = setTimeout(() => {
          this._pendingCommands.delete(id);
          reject(new Error(`CDP超时: ${method}`));
        }, 15000);
        this._pendingCommands.set(id, { resolve, reject, timeout });
        const msg = JSON.stringify({ id, method, params });
        log(`📤 发送: ${method} (id=${id})`);
        this.ws.send(msg);
      });
    };
    
    // 发送命令
    log('⏳ Page.enable...');
    await _send('Page.enable');
    log('✅ Page.enable OK');
    
    log('⏳ Network.enable...');
    await _send('Network.enable');
    log('✅ Network.enable OK');
    
    log('⏳ 注入拦截脚本...');
    await _send('Page.addScriptToEvaluateOnNewDocument', {
      source: getInterceptorScript(),
    });
    log('✅ 脚本注入成功');
    
    log('✅ 页面已就绪');
    
    // 保存 _send 供后续使用
    this._send = _send;
  }
  
  async collectCaptured() {
    /** 从页面获取已捕获的API数据 */
    const result = await this._send('Runtime.evaluate', {
      expression: `
        (function() {
          const data = window.__xianyuCaptured || [];
          window.__xianyuCaptured = [];
          return JSON.stringify(data);
        })()
      `,
      returnByValue: false,
    });
    
    try {
      const text = result.result?.value || result.result?.description || '[]';
      return JSON.parse(text);
    } catch (e) {
      return [];
    }
  }
  
  async navigate(url) {
    /** 导航到指定URL并等待加载 */
    log(`🌐 导航到: ${url.slice(0, 80)}`);
    try {
      await this._send('Page.navigate', { url });
    } catch (e) {
      log(`⚠️ 导航超时但可能已成功，继续...`);
    }
    await sleep(5000);
  }
  
  async scrapeItemDetail(itemId) {
    /** 采集单个商品详情（5维数据） */
    await this.navigate(`https://www.goofish.com/item/${itemId}`);
    await sleep(3000);
    
    const captured = await this.collectCaptured();
    
    for (const c of captured) {
      if (c.api && c.api.includes('pc.detail')) {
        const itemData = parseItemDetail(c);
        if (itemData && itemData.itemId === String(itemId)) {
          // 输出该商品的数据
          log(`  📊 ${String(itemData.title).slice(0, 30)} | 浏览=${itemData.views} 想要=${itemData.wants} 收藏=${itemData.favorites} 留言=${itemData.comments}`);
          return itemData;
        }
      }
    }
    
    return null;
  }
  
  async scrapeShopItems() {
    /** 采集店铺所有商品 */
    log('\n🏪 开始采集店铺商品...');
    
    // 先访问店铺页
    await this.navigate(`https://www.goofish.com/personal?userId=${this.userId}`);
    await sleep(5000);
    
    // 滚动加载更多
    for (let i = 0; i < 5; i++) {
      try {
        await this._send('Runtime.evaluate', {
          expression: 'window.scrollBy(0, 1000)',
        });
      } catch (e) {
        // 忽略滚动超时
      }
      await sleep(1500);
    }
    
    // 收集API数据
    const captured = await this.collectCaptured();
    log(`捕获到 ${captured.length} 个API响应`);
    
    // 提取商品列表
    const allItems = new Map();
    
    for (const c of captured) {
      // 从 detail API 提取 sellerItems
      if (c.api && c.api.includes('pc.detail')) {
        const itemData = parseItemDetail(c);
        if (itemData) {
          allItems.set(itemData.itemId, {
            itemId: itemData.itemId,
            title: itemData.title,
            price: itemData.price,
            views: itemData.views,
            wants: itemData.wants,
            favorites: itemData.favorites,
            comments: itemData.comments,
            reviews: itemData.reviews,
            sellerId: itemData.sellerId,
          });
          
          // sellerItems - 店铺所有商品列表！
          if (itemData.sellerItems && itemData.sellerItems.length > 0) {
            log(`  从detail API获取到 ${itemData.sellerItems.length} 个店铺商品`);
            for (const si of itemData.sellerItems) {
              if (si.itemId && !allItems.has(String(si.itemId))) {
                allItems.set(String(si.itemId), {
                  itemId: String(si.itemId),
                  title: si.title || '',
                  price: si.price || '',
                });
              }
            }
          }
        }
      }
      
      // 从 search API 提取 list 中的商品
      if (c.api && c.api.includes('pc.search')) {
        const items = parseSearchResult(c);
        for (const item of items) {
          if (item.itemId && !allItems.has(item.itemId)) {
            allItems.set(item.itemId, item);
          }
        }
      }
    }
    
    log(`\n📋 共发现 ${allItems.size} 个商品`);
    return allItems;
  }
  
  async scrapeAllItemDetails() {
    /** 采集所有商品的详情（5维数据） */
    const items = this.store.data.items;
    const itemIds = Object.keys(items);
    log(`\n📦 采集 ${itemIds.length} 个商品的详情数据...`);
    
    let count = 0;
    for (const itemId of itemIds) {
      const itemData = await this.scrapeItemDetail(itemId);
      if (itemData) {
        this.store.updateItem(itemData);
        count++;
      }
      await sleep(2000);  // 请求间隔
      
      if (count >= 20) {
        log('⏸️  已达到单次采集上限，分次进行');
        break;
      }
    }
    
    log(`✅ 成功采集 ${count} 个商品详情`);
  }
  
  async runOnce() {
    /** 单次采集全流程 */
    const items = await this.scrapeShopItems();
    
    // 保存所有发现的商品
    for (const [id, data] of items) {
      this.store.updateItem(data);
    }
    
    // 检测下架商品
    for (const [id, item] of Object.entries(this.store.data.items)) {
      if (!items.has(id) && item.status !== 'sold_out') {
        // 可能已下架，需要确认
        if (item.checkCount > 1) {
          this.store.removeItem(id);
        }
      }
    }
    
    // 采集5维数据
    await this.scrapeAllItemDetails();
    
    // 导出
    this.export();
    this.store.printReport();
    
    return Object.keys(items).length;
  }
  
  async runLoop(interval = CONFIG.checkInterval) {
    /** 持续监控循环 */
    log(`\n🚀 开始持续监控 (间隔: ${interval}秒)`);
    
    let round = 0;
    while (true) {
      round++;
      log(`\n${'='.repeat(50)}`);
      log(`第 ${round} 轮检查 - ${new Date().toLocaleString()}`);
      log('='.repeat(50));
      
      try {
        await this.runOnce();
      } catch (e) {
        log(`❌ 检查失败: ${e.message}`, 'ERROR');
        console.error(e);
      }
      
      log(`\n⏳ {interval}秒后下一轮检查...`);
      await sleep(interval * 1000);
    }
  }
  
  export() {
    /** 导出数据 */
    const dir = CONFIG.exportDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    this.store.exportCSV(path.join(dir, `店铺监控_${dateStr}.csv`));
    this.store.exportJSON(path.join(dir, `店铺监控_${dateStr}.json`));
  }
}

// ============================================================
//  主入口
// ============================================================

async function main() {
  // 解析参数
  const args = process.argv.slice(2);
  const getArg = (key) => {
    for (const arg of args) {
      if (arg.startsWith(`--${key}=`)) return arg.split('=')[1];
    }
    return null;
  };
  
  const userId = getArg('userId') || '4252893945';  // 沐沐工作室默认ID
  const interval = parseInt(getArg('interval') || '300', 10);
  
  if (args.includes('--export')) {
    const store = new DataStore(CONFIG.dataFile);
    store.exportCSV(path.join(CONFIG.exportDir, `店铺监控_${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}.csv`));
    store.exportJSON(path.join(CONFIG.exportDir, `店铺监控_${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}.json`));
    return;
  }
  
  if (args.includes('--report')) {
    const store = new DataStore(CONFIG.dataFile);
    store.printReport();
    return;
  }
  
  console.log('=' * 60);
  console.log('  闲鱼店铺监控系统 v1.0');
  console.log('=' * 60);
  console.log(`  店铺ID: ${userId}`);
  console.log(`  检查间隔: ${interval}秒`);
  console.log(`  数据文件: ${CONFIG.dataFile}`);
  console.log();
  
  // 启动监控
  const store = new DataStore(CONFIG.dataFile);
  const monitor = new ShopMonitor(userId, store);
  
  try {
    await monitor.connect();
    
    if (args.includes('--once')) {
      await monitor.runOnce();
    } else {
      await monitor.runLoop(interval);
    }
  } catch (e) {
    console.error('❌ 错误:', e.message);
    process.exit(1);
  } finally {
    if (monitor.ws) monitor.ws.close();
  }
}

main().catch(e => {
  console.error('❌ 致命错误:', e);
  process.exit(1);
});
