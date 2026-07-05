/**
 * 爬虫引擎 v5 - 混合模式
 * 
 * 策略:
 *   - 搜索API: 纯HTTP请求（cookie + MD5签名）→ 30个商品/页 ✅
 *   - 详情API: Playwright无头浏览器（通过CDP或独立启动）→ 完整5维数据 ✅
 *   - 店铺API: 通过详情API获取 sellerItems → 全店追踪 ✅
 * 
 * 依赖: Playwright (用于详情API，处理阿里风控)
 *       Cookie (从浏览器提取一次，用于搜索API和保持登录)
 * 
 * 交付方式: 用户首次运行 setup.mjs 提取Cookie, 后续自动运行
 *           不需要用户保持Chrome打开
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(__dirname, 'xianyu_cookies.json');
const APP_KEY = '34839810';
const BASE_URL = 'https://h5api.m.goofish.com/h5';

let cachedSession = null;
let playwrightBrowser = null;

// ========== Cookie/会话管理 ==========

export function loadSession() {
  if (cachedSession) return cachedSession;
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      cachedSession = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
      return cachedSession;
    }
  } catch (e) {}
  return null;
}

export function saveSession(cookieStr) {
  const mh5Match = cookieStr.match(/_m_h5_tk=([^;]+)/);
  if (!mh5Match) throw new Error('Cookie中未找到 _m_h5_tk');
  cachedSession = {
    cookie: cookieStr,
    token: mh5Match[1].split('_')[0],
    savedAt: Date.now()
  };
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cachedSession, null, 2));
  console.log('[Scraper] ✅ Cookie已保存');
  return cachedSession;
}

function getSession() {
  const s = loadSession();
  if (!s) throw new Error('未配置Cookie');
  return s;
}

// ========== 搜索API（纯HTTP） ==========

function sign(api, data, token) {
  const ts = Date.now();
  const ds = JSON.stringify(data);
  return {
    sign: crypto.createHash('md5').update(token + '&' + ts + '&' + APP_KEY + '&' + ds).digest('hex'),
    timestamp: ts, dataStr: ds
  };
}

async function callMTOP(apiName, data, version = '1.0') {
  const s = getSession();
  const { sign: sig, timestamp, dataStr } = sign(apiName, data, s.token);
  const params = new URLSearchParams({
    jsv: '2.7.2', appKey: APP_KEY, t: String(timestamp), sign: sig,
    v: version, type: 'originaljson', api: `mtop.${apiName}`,
    dataType: 'json', timeout: '20000', sessionOption: 'AutoLoginOnly',
  });
  
  const resp = await fetch(`${BASE_URL}/mtop.${apiName}/${version}/?${params}`, {
    method: 'POST',
    headers: {
      'Cookie': s.cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': 'https://www.goofish.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: 'data=' + encodeURIComponent(dataStr)
  });
  
  let text = await resp.text();
  if (text.startsWith('mtopjsonp'))
    text = text.substring(text.indexOf('(') + 1, text.lastIndexOf(')'));
  return JSON.parse(text);
}

export async function checkLogin() {
  try {
    getSession();
    const r = await callMTOP('taobao.idlemessage.pc.loginuser.get', {});
    const ok = r?.ret?.[0]?.startsWith('SUCCESS');
    console.log(`[Scraper] ${ok ? '✅ Cookie有效' : '❌ Cookie无效'}`);
    return ok;
  } catch (e) {
    console.log('[Scraper] 检查失败:', e.message);
    return false;
  }
}

export async function searchAndScrape(keyword, page = 1) {
  console.log(`[Scraper] 搜索 "${keyword}"...`);
  try {
    const json = await callMTOP('taobao.idlemtopsearch.pc.search', {
      pageNumber: page, keyword, fromFilter: false, rowsPerPage: 30,
      sortValue: '', sortField: '', customDistance: '', gps: '',
      propValueStr: {}, customGps: '',
      searchReqFromPage: 'pcSearch', extraFilterValue: '{}', userPositionJson: '{}'
    });
    const list = json?.data?.resultList || [];
    return list.map(e => {
      const m = e?.data?.item?.main || {};
      const args = m.clickParam?.args || {};
      const ex = m.exContent || {};
      let title = '';
      if (ex.richTitle) title = ex.richTitle.map(t => t?.data?.text || '').join('');
      return {
        itemId: String(args.id || args.item_id || ''),
        title: title || args.title || '', price: args.price || args.displayPrice || '',
        wants: parseInt(args.wantNum || 0, 10),
        views: 0, favorites: 0, comments: 0, reviews: 0
      };
    }).filter(i => i.itemId);
  } catch (e) { console.error('[Scraper] 搜索失败:', e.message); return []; }
}

// ========== 详情API（Playwright无头浏览器） ==========

async function getPlaywrightPage() {
  if (playwrightBrowser?.isConnected()) {
    const pages = playwrightBrowser.contexts()[0]?.pages();
    if (pages?.length > 0) return pages[0];
    return await playwrightBrowser.contexts()[0].newPage();
  }
  // 首次启动Playwright
  const { chromium } = await import('playwright');
  playwrightBrowser = await chromium.launch({ headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await playwrightBrowser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    storageState: loadSession() ? {
      cookies: loadSession().cookie.split(';').map(c => {
        const [n, ...v] = c.trim().split('=');
        return { name: n, value: v.join('='), domain: '.goofish.com', path: '/' };
      }),
      origins: []
    } : undefined
  });
  const page = await context.newPage();
  // 初始化
  await page.goto('https://www.goofish.com/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
  return page;
}

export async function getItemDetail(itemId) {
  let page = null;
  try {
    page = await getPlaywrightPage();
    
    // 拦截详情API响应
    const detailPromise = new Promise(resolve => {
      const handler = async (resp) => {
        const url = resp.url();
        if (url.includes('pc.detail/1.0') && resp.ok()) {
          try {
            const body = await resp.text();
            let j = body;
            if (body.startsWith('mtopjsonp'))
              j = body.substring(body.indexOf('(')+1, body.lastIndexOf(')'));
            const item = JSON.parse(j)?.data?.itemDO;
            if (item) {
              page.removeListener('response', handler);
              resolve({
                itemId: String(item.itemId || ''),
                title: (item.title || '').trim(),
                price: item.soldPrice || item.minPrice || '',
                views: parseInt(item.browseCnt || 0, 10),
                wants: parseInt(item.wantCnt || 0, 10),
                favorites: parseInt(item.collectCnt || 0, 10),
                comments: parseInt(item.interactFavorCnt || 0, 10),
                reviews: 0,
              });
            }
          } catch(e) {}
        }
      };
      page.on('response', handler);
      setTimeout(() => resolve(null), 15000);
    });
    
    await page.goto(`https://www.goofish.com/item?id=${itemId}`, {
      waitUntil: 'networkidle', timeout: 15000
    });
    await page.waitForTimeout(3000);
    
    return await detailPromise;
    
  } catch (e) {
    console.log(`[Scraper] 详情获取失败 ${itemId}: ${e.message}`);
    return null;
  }
}

// ========== 店铺监控 ==========

export async function scrapeStoreItems(seedItemId) {
  console.log(`[Store] 获取店铺信息 (种子:${seedItemId})...`);
  
  // 使用Playwright获取详情+卖家在售列表
  let page = null;
  try {
    page = await getPlaywrightPage();
    
    const result = { seller: null, items: [], newIds: [], goneIds: [] };
    
    // 拦截详情API
    const dataPromise = new Promise(resolve => {
      page.on('response', async (resp) => {
        const url = resp.url();
        try {
          if (url.includes('pc.detail/1.0') && resp.ok()) {
            const body = await resp.text();
            let j = body;
            if (body.startsWith('mtopjsonp'))
              j = body.substring(body.indexOf('(')+1, body.lastIndexOf(')'));
            const d = JSON.parse(j)?.data;
            if (d?.sellerDO?.sellerItems?.length > 0) {
              result.seller = { nick: d.sellerDO.nick, userId: d.sellerDO.sellerId };
              const ids = d.sellerDO.sellerItems.map(s => String(s.itemId)).filter(Boolean);
              if (ids.length > 0) result.itemIds = ids;
            }
            if (d?.itemDO) {
              const item = d.itemDO;
              result.items.push({
                itemId: String(item.itemId), title: (item.title||'').trim(),
                price: item.soldPrice || item.minPrice || '',
                views: parseInt(item.browseCnt||0), wants: parseInt(item.wantCnt||0),
                favorites: parseInt(item.collectCnt||0),
                comments: parseInt(item.interactFavorCnt||0), reviews: 0,
              });
            }
          }
          if (result.items.length > 0 && Object.keys(result).includes('itemIds') && 
              result.items.length >= (result.itemIds?.length || 1)) {
            resolve();
          }
        } catch(e) {}
      });
      setTimeout(() => resolve(), 20000);
    });
    
    // 先获取种子商品 → 得到sellerItems
    await page.goto(`https://www.goofish.com/item?id=${seedItemId}`, {
      waitUntil: 'networkidle', timeout: 15000
    });
    await page.waitForTimeout(3000);
    
    // 遍历在售列表
    if (result.itemIds?.length > 0) {
      console.log(`[Store] 📍 ${result.seller?.nick} | ${result.itemIds.length} 个在售`);
      
      for (const id of result.itemIds) {
        if (id === seedItemId && result.items.length > 0) continue;
        await page.goto(`https://www.goofish.com/item?id=${id}`, {
          waitUntil: 'networkidle', timeout: 15000
        });
        await page.waitForTimeout(2000);
      }
    }
    
    await dataPromise;
    
    // 检测变更
    let old = {};
    try { old = JSON.parse(fs.readFileSync(path.join(__dirname, 'store_snapshot.json'), 'utf-8')); } catch(e) {}
    const oldIds = Object.keys(old);
    const currentIds = result.items.map(i => i.itemId);
    result.newIds = currentIds.filter(id => !oldIds.includes(id));
    result.goneIds = oldIds.filter(id => !currentIds.includes(id));
    
    if (result.newIds.length > 0) console.log(`[Store] 🆕 上新: ${result.newIds.length} 个`);
    if (result.goneIds.length > 0) console.log(`[Store] ❌ 下架: ${result.goneIds.length} 个`);
    
    const snapshot = {};
    for (const item of result.items) snapshot[item.itemId] = item;
    fs.writeFileSync(path.join(__dirname, 'store_snapshot.json'), JSON.stringify(snapshot, null, 2));
    
    return result;
    
  } catch (e) {
    console.error('[Store] 失败:', e.message);
    return { seller: null, items: [], newIds: [], goneIds: [] };
  }
}

export async function closeBrowser() {
  if (playwrightBrowser) {
    try { await playwrightBrowser.close(); } catch(e) {}
    playwrightBrowser = null;
  }
}
