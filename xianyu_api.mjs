/**
 * 闲鱼 MTOP API 直连客户端
 * =========================
 * 从 Chrome 提取 Cookie/Token，直接调用 MTOP API，无需浏览器。
 * 
 * 用法:
 *   node xianyu_api.mjs shop --userId=2217571424592     # 查店铺商品
 *   node xianyu_api.mjs detail --item=1059354152213      # 查商品详情(5维)
 *   node xianyu_api.mjs search --keyword=手机             # 搜索商品
 */
import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import crypto from 'crypto';
import { URLSearchParams } from 'url';

const CDP_PORT = 9222;
const MTOP_BASE = 'https://h5api.m.goofish.com/h5';
const APP_KEY = '34839810';

// ============================================================
//  从 Chrome 提取会话信息
// ============================================================

let _session = null;

async function getSession(refresh = false) {
  if (_session && !refresh) return _session;
  
  // 找闲鱼页面
  const targets = await new Promise(r => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => r(JSON.parse(d)));
    });
  });
  
  const xyTarget = targets.find(t => 
    (t.url || '').includes('goofish.com') || (t.title || '').includes('闲鱼')
  );
  if (!xyTarget) throw new Error('请在Chrome中打开闲鱼页面');
  
  // 连接到页面
  const ws = await new Promise(r => {
    const w = new WebSocket(xyTarget.webSocketDebuggerUrl);
    w.on('open', () => r(w));
  });
  
  let _id = 1;
  const pending = new Map();
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id !== undefined) {
        const h = pending.get(msg.id);
        if (h) { clearTimeout(h.t); pending.delete(msg.id); h.r(msg); }
      }
    } catch(e) {}
  });
  
  const send = (m, p) => new Promise(r => {
    const id = _id++;
    const t = setTimeout(() => { pending.delete(id); r({}); }, 10000);
    pending.set(id, { r, t });
    ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  
  await send('Network.enable');
  await new Promise(r => setTimeout(r, 300));
  
  // 获取cookie
  const result = await send('Network.getAllCookies');
  const allCookies = result.result?.cookies || [];
  
  // 只保留闲鱼/淘宝域名下的关键cookie
  const targetDomains = ['.goofish.com', '.taobao.com', '.tmall.com', '.tb.cn', 'h5api.m.goofish.com'];
  const keyCookies = allCookies.filter(c => 
    targetDomains.some(d => c.domain.includes(d))
  );
  
  // 构建cookie字符串 - 按域名排序
  const cookieStr = keyCookies
    .sort((a, b) => a.domain.localeCompare(b.domain))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
  
  // 提取 _m_h5_tk token
  const tkCookie = allCookies.find(c => c.name === '_m_h5_tk');
  const token = tkCookie ? tkCookie.value.split('_')[0] : '';
  
  ws.close();
  
  _session = { cookies: cookieStr, token, cookieCount: keyCookies.length };
  return _session;
}

// ============================================================
//  MTOP 请求
// ============================================================

function createSign(token, ts, dataStr) {
  const signStr = `${token}&${ts}&${APP_KEY}&${dataStr}`;
  return crypto.createHash('md5').update(signStr).digest('hex');
}

async function callMTOP(apiName, data, extraParams = {}) {
  const session = await getSession();
  
  const ts = Date.now();
  const dataStr = JSON.stringify(data);
  const sign = createSign(session.token, ts, dataStr);
  
  // URL参数 - 完全匹配浏览器
  const params = {
    jsv: '2.7.2',
    appKey: APP_KEY,
    t: String(ts),
    sign: sign,
    v: '1.0',
    type: 'originaljson',
    api: `mtop.${apiName}`,
    dataType: 'json',
    timeout: '20000',
    accountSite: 'xianyu',
    sessionOption: 'AutoLoginOnly',
    ...extraParams,  // 额外的参数如 spm_cnt
  };
  
  const qs = new URLSearchParams(params).toString();
  const url = `${MTOP_BASE}/mtop.${apiName}/1.0/?${qs}`;
  
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Cookie': session.cookies,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://www.goofish.com',
        'Referer': 'https://www.goofish.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const match = body.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
          const parsed = match ? JSON.parse(match[1]) : JSON.parse(body);
          
          if (parsed.ret?.[0]?.startsWith('SUCCESS') || parsed.ret?.[0]?.startsWith('FAIL')) {
            resolve(parsed);
          } else {
            reject(new Error(`API异常: ${JSON.stringify(parsed.ret)}`));
          }
        } catch(e) {
          reject(new Error(`解析失败: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    
    // 请求体 - URL编码
    const bodyData = new URLSearchParams({ data: dataStr }).toString();
    req.write(bodyData);
    req.end();
  });
}

// ============================================================
//  API 封装
// ============================================================

async function getShopItems(userId) {
  /** 获取店铺所有商品 */
  const result = await callMTOP('idle.web.xyh.item.list', {
    needGroupInfo: true,
    pageNumber: 1,
    userId: String(userId),
    pageSize: 20,
  }, { spm_cnt: 'a21ybx.personal.0.0' });
  
  const items = (result.data?.cardList || []).map(card => {
    const cd = card.cardData || {};
    return {
      itemId: String(cd.id || ''),
      title: cd.title || '',
      price: cd.priceInfo?.price || cd.priceInfo?.soldPrice || '',
      image: cd.picInfo?.url || '',
      status: cd.itemStatus || '',
    };
  }).filter(i => i.itemId);
  
  return {
    total: result.data?.totalCount || items.length,
    items,
    raw: result,
  };
}

async function getItemDetail(itemId) {
  /** 获取商品详情（含5维数据） */
  const result = await callMTOP('taobao.idle.pc.detail', {
    id: String(itemId),
    returnItemDO: true,
    needSellerDO: true,
  }, { spm_cnt: 'a21ybx.item.0.0' });
  
  const data = result.data || {};
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
    sellerId: String(seller.sellerId || ''),
    sellerName: seller.nick || '',
    pubTime: item.gmtCreate || '',
    sellerItems: (seller.sellerItems || []).map(si => ({
      itemId: String(si.itemId || ''),
      title: si.title || '',
      price: si.price || '',
    })),
    raw: result,
  };
}

// ============================================================
//  主入口
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const getArg = (key) => {
    for (const a of args) if (a.startsWith(`--${key}=`)) return a.split('=')[1];
    return null;
  };
  
  console.log('=' * 55);
  console.log('  闲鱼 MTOP API 直连客户端');
  console.log('=' + '=' * 55);
  
  try {
    const session = await getSession();
    console.log(`✅ 已获取会话 (${session.cookieCount}个Cookie, token=${session.token.slice(0, 10)}...)`);
    console.log();
    
    if (command === 'shop') {
      const userId = getArg('userId') || getArg('shop');
      if (!userId) { console.log('请指定 --userId'); return; }
      
      console.log(`📦 查询店铺商品: userId=${userId}`);
      const result = await getShopItems(userId);
      
      console.log(`\n共 ${result.items.length} 个商品:\n`);
      result.items.forEach((item, i) => {
        console.log(`  ${i+1}. [${item.itemId}] ${item.title.slice(0, 40).padEnd(42)} ¥${item.price || '?'}`);
      });
      
      // 如果只查到一个商品特殊处理
      if (result.items.length === 0) {
        console.log('  (该店铺没有在售商品)');
        console.log(`\n原始响应: ${JSON.stringify(result.raw).slice(0, 300)}`);
      }
      
    } else if (command === 'detail') {
      const itemId = getArg('item');
      if (!itemId) { console.log('请指定 --item'); return; }
      
      console.log(`📄 查询商品详情: itemId=${itemId}\n`);
      const detail = await getItemDetail(itemId);
      
      console.log(`  标题: ${detail.title}`);
      console.log(`  价格: ¥${detail.price}`);
      console.log(`  👁 浏览: ${detail.views}`);
      console.log(`  ❤️ 想要: ${detail.wants}`);
      console.log(`  ⭐ 收藏: ${detail.favorites}`);
      console.log(`  💬 留言: ${detail.comments}`);
      console.log(`  📝 评价: ${detail.reviews}`);
      console.log(`  卖家: ${detail.sellerName} (ID: ${detail.sellerId})`);
      
      if (detail.sellerItems.length > 0) {
        console.log(`\n  该卖家还有 ${detail.sellerItems.length} 个商品:`);
        detail.sellerItems.slice(0, 5).forEach(si => {
          console.log(`    ${si.title.slice(0, 40)} ¥${si.price || '?'}`);
        });
        console.log(`\n  💡 监控店铺: node xianyu_api.mjs shop --userId=${detail.sellerId}`);
      }
      
    } else if (command === 'search') {
      const keyword = getArg('keyword');
      if (!keyword) { console.log('请指定 --keyword'); return; }
      
      console.log(`🔍 搜索: ${keyword}\n`);
      const result = await callMTOP('taobao.idlemtopsearch.pc.search', {
        pageNumber: 1, keyword, fromFilter: false, rowsPerPage: 30,
        sortValue: '', sortField: '', customDistance: '', gps: '',
        propValueStr: {}, customGps: '',
        searchReqFromPage: 'pcSearch', extraFilterValue: '{}', userPositionJson: '{}',
      }, { spm_cnt: 'a21ybx.search.0.0' });
      
      const items = (result.data?.resultList || []).map(e => {
        const args = e?.data?.item?.main?.clickParam?.args || {};
        const ex = e?.data?.item?.main?.exContent || {};
        let title = '';
        if (ex.richTitle) title = ex.richTitle.map(t => t?.data?.text || '').join('');
        return {
          itemId: String(args.id || args.item_id || ''),
          title: title || args.title || '',
          price: args.price || args.displayPrice || '',
          wants: parseInt(args.wantNum || 0, 10),
        };
      }).filter(i => i.itemId);
      
      console.log(`共 ${items.length} 条结果:\n`);
      items.slice(0, 10).forEach((item, i) => {
        console.log(`  ${i+1}. [${item.itemId}] ${item.title.slice(0, 40).padEnd(42)} ¥${item.price || '?'} ❤️${item.wants}`);
      });
      
    } else {
      console.log('\n用法:');
      console.log('  node xianyu_api.mjs shop --userId=店铺ID      # 查店铺商品');
      console.log('  node xianyu_api.mjs detail --item=商品ID       # 查商品5维数据');
      console.log('  node xianyu_api.mjs search --keyword=关键词     # 搜索商品');
      console.log();
      console.log('示例:');
      console.log('  node xianyu_api.mjs shop --userId=2217571424592');
      console.log('  node xianyu_api.mjs detail --item=1059354152213');
    }
  } catch (e) {
    console.error(`❌ 错误: ${e.message}`);
    process.exit(1);
  }
}

main();
