#!/usr/bin/env node
/**
 * 闲鱼实时监控系统 v2.0
 * ========================
 * 逆向 + 爬虫方式实现。
 * 通过 CDP 连接 Chrome，使用独立标签页操作闲鱼 Web 版，
 * 结合 DOM 抓取 + API 拦截 两种方式采集商品数据。
 *
 * 功能:
 *   - 店铺上新检测
 *   - 标题/价格变更检测
 *   - 浏览数/想要数/收藏数/留言数/评价数 追踪
 *   - CSV/JSON 导出
 *   - 控制台统计报表
 *
 * 用法:
 *   1. 启动 Chrome: chrome --remote-debugging-port=9222
 *   2. 打开 https://www.goofish.com/ 并登录 (给浏览器种 cookie)
 *   3. 运行: node monitor_xianyu.mjs
 *
 *   可选参数:
 *     --keyword=xxx  监控关键词 (默认: 从数据文件读取)
 *     --interval=5   检查间隔分钟 (默认: 5)
 *     --pages=3      搜索翻页数 (默认: 3)
 *     --export       立即导出 CSV
 *     --report       只打印报表不检查
 */
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

// ============================================================
//  配置
// ============================================================
const CONFIG = {
  chromeUrl: 'http://localhost:9222',
  dataFile: path.resolve('xianyu_monitor_data.json'),
  exportDir: path.resolve('exports'),
  checkInterval: 5,
  keyword: '',
  maxPages: 1,
  rowsPerPage: 30,
};

// 解析命令行参数
const args = process.argv.slice(2);
for (const arg of args) {
  const [k, v] = arg.split('=');
  if (k === '--keyword') CONFIG.keyword = v;
  if (k === '--interval') CONFIG.checkInterval = parseInt(v) || 5;
  if (k === '--pages') CONFIG.maxPages = parseInt(v) || 1;
  if (k === '--export-only') CONFIG.exportOnly = true;
  if (k === '--report-only') CONFIG.reportOnly = true;
}

// ============================================================
//  工具函数
// ============================================================
function log(level, msg, data = null) {
  const ts = new Date().toLocaleString('zh-CN');
  const prefix = { I: '📗', W: '📙', E: '📕', S: '📘', N: '🆕', C: '✏️' }[level] || '📄';
  console.log(`${prefix} [${ts}] ${msg}`);
  if (data) console.log(`   ${JSON.stringify(data).substring(0, 300)}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtNum(n) {
  n = parseInt(n) || 0;
  if (n > 10000) return (n / 10000).toFixed(1) + '万';
  return n.toString();
}

// ============================================================
//  CDP 连接管理器
// ============================================================
class CDPManager {
  constructor() {
    this.pageWs = null;
    this.targetId = null;
    this.msgId = 1;
    this.pending = new Map();
    this.onMessage = null;
  }

  async _getBrowserWSUrl() {
    const resp = await fetch(`${CONFIG.chromeUrl}/json/version`);
    const info = await resp.json();
    return info.webSocketDebuggerUrl;
  }

  async _createNewTab() {
    const bwsUrl = await this._getBrowserWSUrl();
    return new Promise((resolve, reject) => {
      const bws = new WebSocket(bwsUrl);
      let mid = 1;
      bws.on('open', () => {
        const id = mid++;
        bws.send(JSON.stringify({ id, method: 'Target.createTarget', params: { url: 'about:blank', newWindow: false } }));
        const handler = (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.id === id) {
            bws.removeListener('message', handler);
            bws.close();
            msg.result?.targetId ? resolve(msg.result.targetId) : reject(new Error('创建标签页失败'));
          }
        };
        bws.on('message', handler);
      });
      bws.on('error', reject);
    });
  }

  async connect() {
    this.targetId = await this._createNewTab();
    log('I', `创建监控标签页: ${this.targetId.substring(0, 16)}...`);

    const wsUrl = `ws://localhost:9222/devtools/page/${this.targetId}`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => {
        log('I', 'CDP 连接成功');
        this.pageWs = ws;
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve: res } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            res(msg);
          }
          if (this.onMessage) this.onMessage(msg);
        });
        resolve(ws);
      });
      ws.on('error', (err) => reject(new Error(`CDP连接失败: ${err.message}`)));
      ws.on('close', () => { log('W', 'CDP 断开'); this.pageWs = null; });
    });
  }

  async send(method, params = {}) {
    const id = this.msgId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP超时: ${method}`)), 35000);
      this.pending.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r); } });
      this.pageWs.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 注入初始化脚本（在页面加载前注入，用于拦截API） */
  async addInitScript(scriptSource) {
    return await this.send('Page.addScriptToEvaluateOnNewDocument', {
      source: scriptSource
    });
  }

  /**
   * 通过 CDP Network 域直接拦截 API 响应体
   * 比页面注入更可靠，能捕获大响应体
   * 返回: [{url, body}]
   */
  async captureAPIBodies(timeout = 15000) {
    const bodies = [];
    const pendingReqs = new Map();
    let resolvePromise = null;
    const timer = setTimeout(() => {
      if (resolvePromise) resolvePromise(bodies);
    }, timeout);

    // 直接监听底层 WebSocket 消息（不走 onMessage 代理，确保实时性）
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      
      // 捕获 MTOP API 请求
      if (msg.method === 'Network.responseReceived') {
        const url = msg.params.response.url;
        if (url.includes('h5api.m.goofish.com')) {
          pendingReqs.set(msg.params.requestId, url);
        }
      }
      
      // 加载完成时立即获取响应体
      if (msg.method === 'Network.loadingFinished') {
        const reqId = msg.params.requestId;
        if (pendingReqs.has(reqId)) {
          const apiUrl = pendingReqs.get(reqId);
          pendingReqs.delete(reqId);
          
          // 立即通过 send 获取响应体（不能 await，所以用 then）
          this.getResponseBody(reqId).then(body => {
            if (body && body.length > 100) {
              bodies.push({ url: apiUrl, body, reqId });
            }
          }).catch(() => {});
        }
      }
    };

    this.pageWs.on('message', handler);
    
    return new Promise(resolve => {
      resolvePromise = resolve;
    }).finally(() => {
      clearTimeout(timer);
      this.pageWs.removeListener('message', handler);
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.result?.exceptionDetails) {
      throw new Error(result.result.exceptionDetails.text || 'eval error');
    }
    return result.result?.result?.value;
  }

  async navigate(url, waitMs = 4000) {
    log('I', `导航: ${url.substring(0, 80)}`);
    await this.send('Page.navigate', { url });
    await sleep(waitMs);
  }

  async enableNetwork() {
    await this.send('Network.enable', { maxTotalBufferSize: 200000000, maxResourceBufferSize: 100000000 });
    await this.send('Page.enable');
  }

  async getResponseBody(requestId) {
    try {
      const r = await this.send('Network.getResponseBody', { requestId });
      return r.result?.body || null;
    } catch (e) { return null; }
  }

  disconnect() {
    if (this.pageWs) { this.pageWs.close(); this.pageWs = null; }
  }

  setMsgHandler(handler) { this.onMessage = handler; }
}

// ============================================================
//  数据采集器 (DOM抓取为主 + API拦截为辅)
// ============================================================
class Scraper {
  constructor(cdp) {
    this.cdp = cdp;
  }

  /**
   * 从当前页面 DOM 抓取商品列表
   * 返回: [{itemId, title, price, wants, url}]
   */
  async scrapeFromDOM() {
    const js = `
      (() => {
        const results = [];
        const seen = new Set();
        
        // 策略1: 找所有 "人想要" 的卡片
        document.querySelectorAll('a[href*="item"], [class*="feeds-item"], [class*="card"]').forEach(el => {
          const text = el.innerText || '';
          const wantMatch = text.match(/(\\d+)\\s*人想要/);
          if (!wantMatch) return;
          
          const priceMatch = text.match(/[¥￥]\\s*(\\d+(?:\\.\\d+)?)/);
          const titleEl = el.querySelector('[class*="title"], [class*="Title"], [class*="name"]');
          let title = '';
          if (titleEl) title = titleEl.textContent.trim();
          if (!title || title.length < 3) {
            // 从所有子节点找最长的文本
            const texts = [];
            el.querySelectorAll('*').forEach(n => {
              const t = (n.textContent || '').trim();
              if (t.length > 5 && !t.includes('¥') && !t.includes('人想要') && !t.includes('包邮')) texts.push(t);
            });
            title = texts.sort((a,b) => b.length - a.length)[0] || '';
          }
          
          const href = el.tagName === 'A' ? el.href : (el.closest('a')?.href || '');
          const itemId = href.match(/[?&]id=(\\d+)/)?.[1] || '';
          
          if (title && title.length > 3 && !seen.has(title.substring(0,20))) {
            seen.add(title.substring(0,20));
            results.push({
              itemId,
              title: title.replace(/\\n/g, ' ').substring(0, 100),
              price: priceMatch ? priceMatch[1] : '',
              wants: parseInt(wantMatch[1], 10),
              url: href
            });
          }
        });
        
        // 策略2: 如果策略1没抓到，用更宽泛的匹配
        if (results.length === 0) {
          document.querySelectorAll('a').forEach(a => {
            const text = a.innerText || '';
            const wantMatch = text.match(/(\\d+)\\s*人想要/);
            if (!wantMatch) return;
            const href = a.href || '';
            const itemId = href.match(/[?&]id=(\\d+)/)?.[1] || '';
            const priceMatch = text.match(/[¥￥]\\s*(\\d+(?:\\.\\d+)?)/);
            // 提取标题: 取"人想要"前面的文本
            const beforeWant = text.substring(0, text.indexOf('人想要'));
            const lines = beforeWant.split('\\n').filter(l => l.trim().length > 4 && !l.includes('¥'));
            const title = lines[lines.length - 1] || '';
            
            if (title && title.length > 3 && !seen.has(title.substring(0,20))) {
              seen.add(title.substring(0,20));
              results.push({
                itemId,
                title: title.trim().substring(0, 100),
                price: priceMatch ? priceMatch[1] : '',
                wants: parseInt(wantMatch[1], 10),
                url: href
              });
            }
          });
        }
        
        return results;
      })()
    `;

    try {
      const result = await this.cdp.eval(js);
      return Array.isArray(result) ? result : [];
    } catch (e) {
      log('W', `DOM抓取出错: ${e.message}`);
      return [];
    }
  }

  /**
   * 执行搜索并采集数据
   * 通过 CDP Network 域直接捕获 MTOP API 响应体获取完整数据
   */
  async searchAndScrape(keyword) {
    log('I', `搜索 "${keyword}"...`);

    // 1. 导航到搜索页并捕获API
    const capturePromise = this.cdp.captureAPIBodies(18000);
    await this.cdp.send('Page.navigate', {
      url: `https://www.goofish.com/search?q=${encodeURIComponent(keyword)}`
    });
    const captured = await capturePromise;
    
    let allItems = [];

    // 2. 解析搜索API响应
    if (captured.length > 0) {
      log('I', `捕获到 ${captured.length} 个API响应`);
      for (const cap of captured) {
        const items = this._parseMTOPItems(cap.body, cap.url);
        if (items.length > 0) {
          allItems.push(...items);
        }
      }
    }

    // 3. 搜索API未提取到 → DOM抓取
    if (allItems.length === 0) {
      log('W', '搜索API提取失败，DOM抓取...');
      allItems.push(...await this.scrapeFromDOM());
    }

    // 去重
    const seen = new Set();
    allItems = allItems.filter(i => { 
      if (!i.itemId || seen.has(i.itemId)) return false; 
      seen.add(i.itemId); return true; 
    });

    if (allItems.length === 0) return [];

    log('I', `获取到 ${allItems.length} 个商品`);

    // 4. 对前N个商品，导航到详情页获取完整统计数据
    const detailBatchSize = 5;
    const itemsNeedingDetail = allItems.filter(i => i.views === 0 && i.favorites === 0).slice(0, detailBatchSize);
    
    if (itemsNeedingDetail.length > 0) {
      log('I', `获取 ${itemsNeedingDetail.length} 个商品详情数据(浏览/收藏)...`);
      
      for (const item of itemsNeedingDetail) {
        try {
          // 启动详情API捕获
          const detailCapture = this.cdp.captureAPIBodies(10000);
          
          // 导航到详情页
          await this.cdp.send('Page.navigate', {
            url: `https://www.goofish.com/item?id=${item.itemId}`
          });
          await sleep(7000);
          
          // 获取捕获的详情API响应
          const detailBodies = await detailCapture;
          let detailFound = false;
          
          for (const dcap of detailBodies) {
            if (dcap.url.includes('pc.detail')) {
              const detailItems = this._parseMTOPItems(dcap.body);
              if (detailItems.length > 0) {
                const d = detailItems[0];
                item.views = d.views || item.views;
                item.wants = d.wants || item.wants;
                item.favorites = d.favorites || item.favorites;
                item.comments = d.comments || item.comments;
                item.reviews = d.reviews || item.reviews;
                if (d.title && d.title.length > 3) item.title = d.title;
                if (d.price) item.price = d.price;
                detailFound = true;
                break;
              }
            }
          }
          
          if (!detailFound) {
            log('W', `  详情API未捕获到 ${item.itemId}`);
          }
        } catch(e) {
          log('W', `详情获取失败 ${item.itemId}: ${e.message}`);
        }
      }
      
      const withStats = allItems.filter(i => i.views > 0).length;
      log('I', `${withStats}/${allItems.length} 个商品有浏览数据`);
    }

    return allItems;
  }

  /** 批量抓取商品详情（打开详情页 -> 提取数据 -> 返回） */
  async _batchScrapeDetails(itemIds) {
    const results = {};
    for (let i = 0; i < itemIds.length; i++) {
      const id = itemIds[i];
      try {
        // 导航到详情页
        await this.cdp.send('Page.navigate', {
          url: `https://www.goofish.com/item?id=${id}`
        });
        await sleep(4000);

        // 提取页面中的各种数据
        const data = await this.cdp.eval(`(() => {
          const text = document.body?.innerText || '';
          const getNum = (pattern) => {
            const m = text.match(pattern);
            return m ? parseInt(m[1], 10) : 0;
          };
          
          // 尝试多种可能的模式
          const title = document.title.replace(/ - 闲鱼/, '').trim();
          
          // 价格
          const priceMatch = text.match(/[¥￥]\\s*(\\d+(?:\\.\\d+)?)/);
          
          // 浏览: "XXX次浏览" 或 "浏览量 XXX"
          const views = getNum(/(\\d+)\\s*次浏览/);
          
          // 想要: "XXX人想要"
          const wants = getNum(/(\\d+)\\s*人想要/);
          
          // 收藏: "XXX人收藏" 或 "收藏 XXX"
          const favorites = getNum(/(\\d+)\\s*人收藏/);
          
          // 留言: "XXX条留言" 或 "留言 XXX条"
          const comments = getNum(/(\\d+)\\s*条留言/);
          
          // 评价: "XXX条评价" 或 "评价 XXX"
          const reviews = getNum(/(\\d+)\\s*条评价/);
          
          // 有时数据格式是 "浏览 123" 或 "想要 456"
          const views2 = text.match(/浏览[：:]?\\s*(\\d+)/);
          const wants2 = text.match(/想要[：:]?\\s*(\\d+)/);
          const favs2 = text.match(/收藏[：:]?\\s*(\\d+)/);
          
          return {
            title: title || '',
            price: priceMatch ? priceMatch[1] : '',
            views: views || (views2 ? parseInt(views2[1]) : 0),
            wants: wants || (wants2 ? parseInt(wants2[1]) : 0),
            favorites: favorites || (favs2 ? parseInt(favs2[1]) : 0),
            comments: comments || 0,
            reviews: reviews || 0,
            textLength: text.length
          };
        })()`);

        if (data && data.textLength > 100) {
          results[id] = data;
        }
      } catch (e) {
        log('W', `详情${id}抓取失败: ${e.message}`);
      }
    }
    return results;
  }

  /** 解析 MTOP 响应中的商品 */
  _parseMTOPItems(text, debugUrl = '') {
    try {
      let jsonStr = text;
      if (text.startsWith('mtopjsonp')) {
        const s = text.indexOf('(') + 1;
        const e = text.lastIndexOf(')');
        if (s > 0 && e > s) jsonStr = text.substring(s, e);
      }
      const json = JSON.parse(jsonStr);
      if (json.ret && json.ret[0] && !json.ret[0].startsWith('SUCCESS')) return [];

      const apiName = json.api || '';
      const data = json.data;
      if (!data) return [];

      // === 商品详情API: mtop.taobao.idle.pc.detail ===
      // 含浏览数(browseCnt)、想要数(wantCnt)、收藏数(collectCnt)
      if (apiName.includes('pc.detail') && data.itemDO) {
        const item = data.itemDO;
        return [{
          itemId: String(item.itemId || ''),
          title: (item.title || '').trim(),
          price: item.soldPrice || item.minPrice || '',
          views: parseInt(item.browseCnt || 0, 10),
          wants: parseInt(item.wantCnt || 0, 10),
          favorites: parseInt(item.collectCnt || 0, 10),
          comments: parseInt(item.interactFavorCnt || 0, 10),
          reviews: 0,
          pubTime: item.gmtCreate || '',
          url: `https://www.goofish.com/item?id=${item.itemId || ''}`,
          sellerName: data.sellerDO?.nick || '',
          location: data.sellerDO?.city || '',
        }].filter(i => i.itemId);
      }

      // === 搜索列表API: mtop.taobao.idlemtopsearch.pc.search ===
      // 数据在 data.resultList[].data.item.main
      if (apiName.includes('pc.search') && Array.isArray(data.resultList)) {
        return data.resultList.map(entry => {
          const main = entry?.data?.item?.main || {};
          const args = main.clickParam?.args || {};
          const exContent = main.exContent || {};
          let title = '';
          if (exContent.richTitle && Array.isArray(exContent.richTitle)) {
            title = exContent.richTitle.map(t => t?.data?.text || '').join('').trim();
          }
          return {
            itemId: String(args.id || args.item_id || ''),
            title: title || args.title || '',
            price: args.price || args.displayPrice || '',
            views: parseInt(args.browseCnt || args.viewCount || 0, 10),
            wants: parseInt(args.wantNum || args.favorNum || 0, 10),
            favorites: parseInt(args.collectNum || 0, 10),
            comments: 0, reviews: 0,
            pubTime: args.publishTime || '',
            url: `https://www.goofish.com/item?id=${args.id || ''}`,
            sellerName: args.nick || '',
            location: args.city || '',
          };
        }).filter(i => i.itemId && i.itemId !== 'undefined');
      }

      return [];
    } catch (e) {
      return [];
    }
  }

  /** 抓取商品详情页数据 */
  async _scrapeItemDetail(itemId) {
    try {
      // 导航到详情页
      await this.cdp.send('Page.navigate', {
        url: `https://www.goofish.com/item?id=${itemId}`
      });
      await sleep(5000);

      // 从页面提取数据
      const js = `
        (() => {
          const text = document.body?.innerText || '';
          const viewMatch = text.match(/(\\d+)\\s*次浏览/);
          const wantMatch = text.match(/(\\d+)\\s*人想要/);
          const priceMatch = text.match(/[¥￥]\\s*(\\d+(?:\\.\\d+)?)/);
          const title = document.title || '';
          
          // 找收藏数
          const favMatch = text.match(/(\\d+)\\s*人收藏/);
          // 找留言/评价 - 通常在页面底部
          const commentMatch = text.match(/(\\d+)\\s*条留言/);
          const reviewMatch = text.match(/(\\d+)\\s*条评价/);
          
          return {
            title: title.replace(' - 闲鱼', '').trim(),
            price: priceMatch ? priceMatch[1] : '',
            views: viewMatch ? parseInt(viewMatch[1]) : 0,
            wants: wantMatch ? parseInt(wantMatch[1]) : 0,
            favorites: favMatch ? parseInt(favMatch[1]) : 0,
            comments: commentMatch ? parseInt(commentMatch[1]) : 0,
            reviews: reviewMatch ? parseInt(reviewMatch[1]) : 0
          };
        })()
      `;

      const detail = await this.cdp.eval(js);
      return detail || null;

    } catch (e) {
      log('W', `详情抓取失败 ${itemId}: ${e.message}`);
      return null;
    }
  }

  /** 从搜索结果快速采集 (只抓DOM，不拦截API) */
  async quickSearch(keyword) {
    await this.cdp.send('Page.navigate', {
      url: `https://www.goofish.com/search?q=${encodeURIComponent(keyword)}`
    });
    await sleep(7000);
    return await this.scrapeFromDOM();
  }
}

// ============================================================
//  数据存储
// ============================================================
class DataStore {
  constructor() {
    this.filePath = CONFIG.dataFile;
    this.data = null;
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        log('I', `加载数据: ${Object.keys(this.data.items || {}).length} 个商品, ${this.data.totalChecks || 0} 次检查`);
      } else {
        this.data = this._createEmpty();
        log('I', '创建新数据文件');
      }
    } catch (e) {
      log('W', `数据文件损坏: ${e.message}, 重建`);
      this.data = this._createEmpty();
    }

    // 如果命令行指定了 keyword，覆盖
    if (CONFIG.keyword) {
      this.data.settings.keyword = CONFIG.keyword;
    } else if (!this.data.settings.keyword) {
      this.data.settings.keyword = '闲鱼';
    }
    CONFIG.keyword = this.data.settings.keyword;

    return this.data;
  }

  _createEmpty() {
    return {
      items: {},
      settings: { keyword: CONFIG.keyword || '闲鱼', checkInterval: CONFIG.checkInterval, createdAt: Date.now() },
      lastUpdated: Date.now(),
      totalChecks: 0,
    };
  }

  save() {
    this.data.lastUpdated = Date.now();
    if (fs.existsSync(this.filePath)) {
      try { fs.copyFileSync(this.filePath, this.filePath.replace('.json', '_backup.json')); } catch (e) { }
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  /** 更新一个商品，检测变更 */
  updateItem(itemData) {
    const id = itemData.itemId;
    if (!id || id === 'undefined') return { changes: [], isNew: false };

    const now = Date.now();
    const existing = this.data.items[id];

    if (existing) {
      const changes = [];

      // 标题变更
      if (existing.title !== itemData.title && itemData.title && existing.title) {
        changes.push({ timestamp: now, type: 'TITLE_CHANGE', message: `"${existing.title.substring(0, 20)}" → "${itemData.title.substring(0, 20)}"` });
      }
      // 价格变更
      if (existing.price !== itemData.price && itemData.price && existing.price) {
        changes.push({ timestamp: now, type: 'PRICE_CHANGE', message: `${existing.price} → ${itemData.price}` });
      }
      // 5维数据变更
      const fields = ['views', 'wants', 'favorites', 'comments', 'reviews'];
      const diffs = [];
      for (const f of fields) {
        const ov = existing[f] || 0;
        const nv = itemData[f] || 0;
        if (ov !== nv) diffs.push(`${f}:${ov}→${nv}`);
      }
      if (diffs.length > 0) {
        changes.push({ timestamp: now, type: 'STATS_CHANGE', message: diffs.join(' | ') });
      }

      // 历史
      const history = existing.history || [];
      history.push({
        timestamp: now,
        title: itemData.title || existing.title,
        price: itemData.price || existing.price,
        views: itemData.views || existing.views || 0,
        wants: itemData.wants || existing.wants || 0,
        favorites: itemData.favorites || existing.favorites || 0,
        comments: itemData.comments || existing.comments || 0,
        reviews: itemData.reviews || existing.reviews || 0,
      });
      if (history.length > 100) history.splice(0, history.length - 100);

      this.data.items[id] = {
        ...existing,
        ...itemData,
        firstSeen: existing.firstSeen,
        lastSeen: now,
        checkCount: (existing.checkCount || 1) + 1,
        changes: [...(existing.changes || []), ...changes],
        history,
      };

      return { changes, isNew: false };
    } else {
      this.data.items[id] = {
        ...itemData,
        firstSeen: now,
        lastSeen: now,
        checkCount: 1,
        changes: [{ timestamp: now, type: 'NEW', message: '新商品上架' }],
        history: [{
          timestamp: now,
          title: itemData.title || '',
          price: itemData.price || '',
          views: itemData.views || 0,
          wants: itemData.wants || 0,
          favorites: itemData.favorites || 0,
          comments: itemData.comments || 0,
          reviews: itemData.reviews || 0,
        }],
      };
      return { changes: [{ timestamp: now, type: 'NEW', message: '新商品上架' }], isNew: true };
    }
  }

  batchUpdate(items) {
    let newCount = 0, changeCount = 0;
    const newItems = [];
    for (const item of items) {
      const r = this.updateItem(item);
      if (r.isNew) { newCount++; newItems.push(item); }
      changeCount += r.changes.length;
    }
    this.data.totalChecks = (this.data.totalChecks || 0) + 1;
    this.save();
    return { newCount, changeCount, newItems };
  }

  getStats() {
    const items = Object.values(this.data.items);
    const now = Date.now();
    const d1 = 86400000;
    return {
      totalItems: items.length,
      activeToday: items.filter(i => (now - i.lastSeen) < d1).length,
      newToday: items.filter(i => (now - i.firstSeen) < d1).length,
      newThisWeek: items.filter(i => (now - i.firstSeen) < 7 * d1).length,
      totalViews: items.reduce((s, i) => s + (i.views || 0), 0),
      totalWants: items.reduce((s, i) => s + (i.wants || 0), 0),
      totalFavorites: items.reduce((s, i) => s + (i.favorites || 0), 0),
      totalComments: items.reduce((s, i) => s + (i.comments || 0), 0),
      totalReviews: items.reduce((s, i) => s + (i.reviews || 0), 0),
      totalChecks: this.data.totalChecks || 0,
      titleChanges: items.filter(i => i.changes?.some(c => c.type === 'TITLE_CHANGE')).length,
      itemsWithWants: items.filter(i => (i.wants || 0) > 0).length,
    };
  }

  exportCSV() {
    const items = Object.values(this.data.items);
    items.sort((a, b) => (b.wants || 0) - (a.wants || 0));

    const lines = [];

    // Sheet1: 商品列表
    lines.push('商品ID,标题,价格,浏览量,想要数,收藏数,留言数,评价数,首次发现,最后更新,检查次数,标题变更');
    for (const item of items) {
      const title = `"${(item.title || '').replace(/"/g, '""')}"`;
      lines.push([
        item.itemId, title, item.price || '',
        item.views || 0, item.wants || 0, item.favorites || 0, item.comments || 0, item.reviews || 0,
        item.firstSeen ? new Date(item.firstSeen).toLocaleString('zh-CN') : '',
        item.lastSeen ? new Date(item.lastSeen).toLocaleString('zh-CN') : '',
        item.checkCount || 1,
        (item.changes || []).filter(c => c.type === 'TITLE_CHANGE').length,
      ].join(','));
    }

    // Sheet2: 历史趋势 (每个商品)
    lines.push('');
    lines.push('=== 历史趋势 ===');
    lines.push('商品ID,标题,时间,价格,浏览量,想要数,收藏数,留言数,评价数');
    for (const item of items.slice(0, 30)) {
      const shortTitle = `"${(item.title || '').replace(/"/g, '""').substring(0, 30)}"`;
      for (const h of (item.history || [])) {
        lines.push([
          item.itemId, shortTitle,
          h.timestamp ? new Date(h.timestamp).toLocaleString('zh-CN') : '',
          h.price || '', h.views || 0, h.wants || 0, h.favorites || 0, h.comments || 0, h.reviews || 0,
        ].join(','));
      }
    }

    // Sheet3: 变更记录
    lines.push('');
    lines.push('=== 变更记录 ===');
    lines.push('时间,类型,商品ID,标题,详情');
    const allChanges = [];
    for (const item of items) {
      if (item.changes) {
        for (const c of item.changes) {
          allChanges.push({ ...c, itemId: item.itemId, title: item.title });
        }
      }
    }
    allChanges.sort((a, b) => b.timestamp - a.timestamp);
    for (const c of allChanges.slice(0, 200)) {
      lines.push([
        c.timestamp ? new Date(c.timestamp).toLocaleString('zh-CN') : '',
        c.type,
        c.itemId || '',
        `"${(c.title || '').replace(/"/g, '""').substring(0, 30)}"`,
        `"${(c.message || '').replace(/"/g, '""')}"`,
      ].join(','));
    }

    const csv = '\ufeff' + lines.join('\n');
    if (!fs.existsSync(CONFIG.exportDir)) fs.mkdirSync(CONFIG.exportDir, { recursive: true });

    const dateStr = new Date().toISOString().split('T')[0];
    const csvFile = path.join(CONFIG.exportDir, `闲鱼监控数据_${dateStr}.csv`);
    fs.writeFileSync(csvFile, csv, 'utf-8');

    const jsonFile = path.join(CONFIG.exportDir, `闲鱼监控数据_${dateStr}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify(items, null, 2), 'utf-8');

    return { csvFile, jsonFile, totalItems: items.length };
  }

  printReport() {
    const stats = this.getStats();
    const items = Object.values(this.data.items);
    const now = Date.now();

    console.log('\n' + '='.repeat(62));
    console.log('   📊  闲鱼监控统计报表');
    console.log('='.repeat(62));
    console.log(`   检查时间:   ${new Date().toLocaleString('zh-CN')}`);
    console.log(`   监控关键词: ${CONFIG.keyword}`);
    console.log(`   总检查次数: ${stats.totalChecks}`);
    console.log('─'.repeat(62));
    console.log(`   📦 监控商品:   ${stats.totalItems}`);
    console.log(`   🆕 今日上新:   ${stats.newToday}`);
    console.log(`   📅 本周上新:   ${stats.newThisWeek}`);
    console.log(`   ✏️  标题变更:   ${stats.titleChanges} 个`);
    console.log(`   ❤️ 有人想要:   ${stats.itemsWithWants} 个`);
    console.log('─'.repeat(62));
    console.log(`   👁  总浏览:    ${fmtNum(stats.totalViews)}`);
    console.log(`   ❤️  总想要:    ${fmtNum(stats.totalWants)}`);
    console.log(`   ⭐  总收藏:    ${fmtNum(stats.totalFavorites)}`);
    console.log(`   💬  总留言:    ${fmtNum(stats.totalComments)}`);
    console.log(`   📝  总评价:    ${fmtNum(stats.totalReviews)}`);
    console.log('─'.repeat(62));

    if (items.length > 0) {
      console.log('\n  🔥 热门 Top 10:');
      console.log(`  ${'#'.padEnd(3)} ${'标题'.padEnd(22)} ${'价格'.padEnd(8)} ${'浏览'.padEnd(6)} ${'想要'.padEnd(6)} ${'收藏'.padEnd(5)} ${'留言'.padEnd(5)}`);
      console.log('  ' + '─'.repeat(60));
      const sorted = [...items].sort((a, b) => (b.wants || 0) - (a.wants || 0)).slice(0, 10);
      sorted.forEach((item, i) => {
        const t = (item.title || '?').substring(0, 20);
        console.log(`  ${(i + 1).toString().padEnd(3)} ${t.padEnd(22)} ${(item.price || '-').padEnd(8)} ${fmtNum(item.views).padEnd(6)} ${fmtNum(item.wants).padEnd(6)} ${fmtNum(item.favorites).padEnd(5)} ${fmtNum(item.comments).padEnd(5)}`);
      });
    }

    // 今日变更
    const todayChanges = [];
    for (const item of items) {
      if (item.changes) {
        for (const c of item.changes) {
          if (c.timestamp > now - 86400000) todayChanges.push({ ...c, title: item.title });
        }
      }
    }
    todayChanges.sort((a, b) => b.timestamp - a.timestamp);

    if (todayChanges.length > 0) {
      console.log('\n  🔔 今日变更:');
      console.log('  ' + '─'.repeat(58));
      todayChanges.slice(0, 25).forEach(c => {
        const icon = { NEW: '🆕', TITLE_CHANGE: '✏️', PRICE_CHANGE: '💲', STATS_CHANGE: '📊' }[c.type] || '📌';
        console.log(`  ${icon} ${fmtTime(c.timestamp)} ${(c.title || '').substring(0, 24)}`);
        if (c.message) console.log(`      ${c.message.substring(0, 70)}`);
      });
    }

    console.log('='.repeat(62) + '\n');
  }
}

// ============================================================
//  监控主循环
// ============================================================
class Monitor {
  constructor() {
    this.cdp = new CDPManager();
    this.scraper = new Scraper(this.cdp);
    this.store = new DataStore();
    this.running = false;
  }

  async start() {
    log('S', '='.repeat(50));
    log('S', '  闲鱼实时监控系统');
    log('S', '='.repeat(50));

    // 加载数据 (会设置 CONFIG.keyword)
    this.store.load();

    log('I', `关键词: "${CONFIG.keyword}" | 间隔: ${CONFIG.checkInterval}分钟`);

    // 只导出模式
    if (CONFIG.exportOnly) {
      const r = this.store.exportCSV();
      log('I', `📥 CSV: ${r.csvFile}`);
      log('I', `📥 JSON: ${r.jsonFile}`);
      return;
    }

    // 只报表模式
    if (CONFIG.reportOnly) {
      this.store.printReport();
      return;
    }

    // 连接 Chrome
    await this.cdp.connect();
    await this.cdp.enableNetwork();

    // 注入 API 拦截脚本（在每个页面加载前注入，捕获MTOP响应）
    try {
      await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `
          (function() {
            if (window.__xianyuMonitorInjected) return;
            window.__xianyuMonitorInjected = true;
            window.__xianyuApiResponses = [];
            
            // 拦截 fetch
            const origFetch = window.fetch.bind(window);
            window.fetch = async function(...args) {
              const url = (typeof args[0] === 'string' ? args[0] : args[0]?.url) || '';
              const isTarget = url.includes('h5api.m.goofish.com') || url.includes('pc.search') || url.includes('item.detail');
              
              try {
                const resp = await origFetch(...args);
                if (isTarget && resp.ok) {
                  const clone = resp.clone();
                  clone.text().then(text => {
                    if (text && text.length > 100) {
                      window.__xianyuApiResponses.push({ url, data: text, time: Date.now() });
                    }
                  }).catch(()=>{});
                }
                return resp;
              } catch(e) { throw e; }
            };
            
            // 也拦截 XHR
            const origXHR = window.XMLHttpRequest;
            const XHRProxy = function() {
              const xhr = new origXHR();
              let url = '';
              const origOpen = xhr.open.bind(xhr);
              xhr.open = function(m, u) { url = u; return origOpen(m, u); };
              xhr.addEventListener('load', function() {
                if (url && (url.includes('h5api') || url.includes('pc.search'))) {
                  try {
                    const text = xhr.responseText;
                    if (text && text.length > 100) {
                      window.__xianyuApiResponses.push({ url, data: text, time: Date.now() });
                    }
                  } catch(e) {}
                }
              });
              return xhr;
            };
            for (const k in origXHR) { try { XHRProxy[k] = origXHR[k]; } catch(e) {} }
            window.XMLHttpRequest = XHRProxy;
          })();
        `
      });
      log('I', '✅ API拦截脚本已注入');
    } catch(e) {
      log('W', `API拦截脚本注入失败: ${e.message}`);
    }

    // 初始化: 导航到闲鱼首页，保证 session 有效
    await this.cdp.navigate('https://www.goofish.com/', 6000);

    // 检查登录状态
    try {
      const loginCheck = await this.cdp.eval('document.body.innerText.includes("发闲置") || document.body.innerText.includes("发布")');
      if (loginCheck) {
        log('I', '✅ 已登录闲鱼');
      } else {
        log('W', '⚠️ 可能未登录，监控将受限');
        log('W', '请在浏览器中打开 goofish.com 并登录');
      }
    } catch (e) {
      log('W', '登录检查失败');
    }

    // 第一次检查
    await this._runCheck();

    // 进入定时循环
    this.running = true;
    this._scheduleLoop();
  }

  _scheduleLoop() {
    if (!this.running) return;
    const ms = CONFIG.checkInterval * 60 * 1000;
    log('I', `下次检查: ${new Date(Date.now() + ms).toLocaleTimeString('zh-CN')}`);

    setTimeout(async () => {
      try {
        await this._runCheck();
      } catch (e) {
        log('E', `检查失败: ${e.message}`);
        try {
          await this.cdp.connect();
          await this.cdp.enableNetwork();
          log('I', '已重连');
        } catch (e2) {
          log('E', `重连失败: ${e2.message}`);
        }
      }
      this._scheduleLoop();
    }, ms);
  }

  async _runCheck() {
    const num = (this.store.data.totalChecks || 0) + 1;
    log('S', `======= 第 ${num} 次检查 =======`);

    // 搜索 + 采集
    const items = await this.scraper.searchAndScrape(CONFIG.keyword);

    if (items.length === 0) {
      // 搜索无结果时，尝试简单的 DOM 扫描兜底
      log('W', '搜索无结果，尝试直接DOM扫描...');
      await this.cdp.navigate('https://www.goofish.com/', 5000);
      // 页面可能有个"猜你喜欢"列表
      const fallbackItems = await this.scraper.scrapeFromDOM();
      if (fallbackItems.length > 0) {
        log('I', `DOM兜底抓到 ${fallbackItems.length} 个商品`);
        const { newCount, changeCount, newItems } = this.store.batchUpdate(fallbackItems);
        log('I', `更新: +${newCount}新 / ${changeCount}变更`);
      } else {
        log('W', '未获取到任何商品数据');
        return;
      }
    } else {
      const { newCount, changeCount, newItems } = this.store.batchUpdate(items);
      log('I', `结果: ${items.length} 商品 | +${newCount} 新 | ${changeCount} 变更`);

      if (newCount > 0) {
        for (const item of newItems) {
          log('N', `上新: ${(item.title || '').substring(0, 40)} [¥${item.price || '?'}] 想要:${item.wants || 0}`);
        }
      }
    }

    // 报表
    this.store.printReport();

    // 定时导出 (每 ~3 小时)
    const exportFreq = Math.max(1, Math.floor(180 / CONFIG.checkInterval));
    if (num === 1 || num % exportFreq === 0) {
      const r = this.store.exportCSV();
      log('I', `📥 导出: ${r.csvFile}`);
    }
  }

  async stop() {
    this.running = false;
    this.store.save();
    const r = this.store.exportCSV();
    log('I', `📥 最终导出: ${r.csvFile}`);
    this.cdp.disconnect();
    log('S', '监控已停止');
  }
}

// ============================================================
//  主入口
// ============================================================
async function main() {
  // 处理 --help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
闲鱼实时监控系统 v2.0

用法:
  node monitor_xianyu.mjs [选项]

选项:
  --keyword=xxx  监控关键词 (搜索词/用户名)
  --interval=N   检查间隔分钟 (默认: 5)
  --pages=N      翻页数 (默认: 1)
  --export-only  只导出 CSV
  --report-only  只打印报表

首次运行:
  1. 启动 Chrome: chrome --remote-debugging-port=9222
  2. 打开 goofish.com 并登录
  3. 运行: node monitor_xianyu.mjs --keyword=要监控的关键词

示例:
  node monitor_xianyu.mjs --keyword=workbuddy
  node monitor_xianyu.mjs --keyword=闲鱼 --interval=10
    `);
    return;
  }

  const monitor = new Monitor();

  const shutdown = async () => {
    log('S', '正在停止...');
    await monitor.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await monitor.start();
  } catch (e) {
    log('E', `启动失败: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
