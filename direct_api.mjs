/**
 * 闲鱼 API 直接调用工具
 * =====================
 * 从 Chrome 提取 Cookie 后，直接调用 MTOP API，无需打开浏览器。
 * 
 * 用法:
 *   node direct_api.mjs --userId=2217571424592      # 查店铺商品
 *   node direct_api.mjs --item=1059354152213          # 查商品详情(5维数据)
 *   node direct_api.mjs --cookies                     # 导出cookies
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
//  从Chrome提取Cookie
// ============================================================

async function getCookiesFromChrome() {
  // 先找一个闲鱼页面
  const targets = await new Promise(r => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => r(JSON.parse(d)));
    });
  });
  
  const xyTarget = targets.find(t => 
    (t.url || '').includes('goofish.com') || (t.title || '').includes('闲鱼')
  );
  if (!xyTarget) {
    console.log('❌ 未找到闲鱼页面，请在Chrome中打开一个闲鱼页面');
    return null;
  }
  
  // 连接到页面
  const ws = await new Promise(r => {
    const w = new WebSocket(xyTarget.webSocketDebuggerUrl);
    w.on('open', () => r(w));
  });
  
  let _cmdId = 1;
  const pendingMap = new Map();
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id !== undefined) {
        const h = pendingMap.get(msg.id);
        if (h) { clearTimeout(h.t); pendingMap.delete(msg.id); h.r(msg); }
      }
    } catch(e) {}
  });
  
  const send = (m, p) => new Promise(r => {
    const id = _cmdId++;
    const t = setTimeout(() => { pendingMap.delete(id); r({}); }, 8000);
    pendingMap.set(id, { r, t });
    ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  
  // 直接提取cookie（页面已打开，cookie已存在）
  await send('Network.enable');
  await new Promise(r => setTimeout(r, 500));
  const result = await send('Network.getAllCookies');
  const cookies = result.result?.cookies || [];
  
  // 过滤闲鱼相关的cookie
  const xianyuCookies = cookies.filter(c => 
    c.domain.includes('goofish.com') || c.domain.includes('taobao.com') || c.domain.includes('tb.cn')
  );
  
  // 构建cookie字符串
  const cookieStr = xianyuCookies.map(c => `${c.name}=${c.value}`).join('; ');
  
  // 提取 _m_h5_tk 用于签名
  const tkCookie = cookies.find(c => c.name === '_m_h5_tk');
  const token = tkCookie ? tkCookie.value.split('_')[0] : '';
  
  console.log(`   域名: ${xianyuCookies.map(c => c.domain).filter((v,i,a) => a.indexOf(v)===i).join(', ')}`);
  ws.close();
  
  return { cookies: cookieStr, token, cookieList: xianyuCookies };
}

// ============================================================
//  MTOP API 签名和调用
// ============================================================

function signRequest(api, data, token) {
  const ts = Date.now();
  const dataStr = JSON.stringify(data);
  const signStr = `${token}&${ts}&${APP_KEY}&${dataStr}`;
  const sign = crypto.createHash('md5').update(signStr).digest('hex');
  return { ts, sign, dataStr };
}

async function callMTOP(apiName, data, cookies, token, version = '1.0') {
  const { ts, sign, dataStr } = signRequest(apiName, data, token);
  
  const params = new URLSearchParams({
    jsv: '2.7.2',
    appKey: APP_KEY,
    t: String(ts),
    sign,
    v: version,
    type: 'originaljson',
    api: `mtop.${apiName}`,
    dataType: 'json',
    timeout: '20000',
    sessionOption: 'AutoLoginOnly',
  });
  
  const url = `${MTOP_BASE}/mtop.${apiName}/${version}/?${params}`;
  
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Cookie': cookies,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://www.goofish.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        const match = body.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
        if (match) {
          try { resolve(JSON.parse(match[1])); } catch(e) { reject(new Error('JSONP parse error')); }
        } else {
          try { resolve(JSON.parse(body)); } catch(e) { reject(new Error('JSON parse error: ' + body.slice(0, 100))); }
        }
      });
    });
    req.on('error', reject);
    req.write(`data=${encodeURIComponent(dataStr)}`);
    req.end();
  });
}

// ============================================================
//  数据解析
// ============================================================

function parseItemsFromXyhList(data) {
  /** 解析 xyh.item.list 响应的商品列表 */
  const items = [];
  const cardList = data?.cardList || [];
  
  for (const card of cardList) {
    const cd = card.cardData || card.data || card;
    const itemId = String(cd.id || cd.itemId || '');
    if (itemId) {
      let title = cd.title || '';
      if (!title && cd.detailUrl) {
        try { title = decodeURIComponent(cd.detailUrl.split('/').pop() || '').replace(/_/g, ' '); } catch(e) {}
      }
      
      let price = '';
      if (cd.priceInfo) {
        price = cd.priceInfo.price || cd.priceInfo.soldPrice || cd.priceInfo.reservePrice || '';
      }
      
      items.push({ itemId, title: title || '', price: String(price), image: cd.picInfo?.url || '' });
    }
  }
  
  return items;
}

function parseItemDetail(data) {
  /** 解析 pc.detail 响应的5维数据 */
  const item = data?.itemDO || data?.item || {};
  const seller = data?.sellerDO || {};
  
  const itemId = String(item.itemId || '');
  if (!itemId) return null;
  
  return {
    itemId,
    title: (item.title || '').trim(),
    price: item.soldPrice || item.minPrice || item.price || '',
    views: parseInt(item.browseCnt || 0, 10),
    wants: parseInt(item.wantCnt || 0, 10),
    favorites: parseInt(item.collectCnt || 0, 10),
    comments: parseInt(item.interactFavorCnt || 0, 10),
    reviews: parseInt(item.evaluateCnt || 0, 10),
    sellerId: String(seller.sellerId || ''),
    sellerName: seller.nick || '',
    sellerItems: seller.sellerItems || [],
  };
}

// ============================================================
//  主流程
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const userId = args.find(a => a.startsWith('--userId='))?.split('=')[1];
  const itemId = args.find(a => a.startsWith('--item='))?.split('=')[1];
  
  console.log('=' * 55);
  console.log('  闲鱼 API 直连工具 (无需浏览器)');
  console.log('=' * 55);
  
  // 1. 从Chrome提取Cookie
  console.log('\n📡 从Chrome提取登录凭证...');
  const session = await getCookiesFromChrome();
  if (!session) {
    console.log('❌ 无法获取cookie，请确保Chrome已打开闲鱼页面且已登录');
    return;
  }
  
  console.log(`✅ 已获取Cookie (${session.cookieList.length}个)`);
  console.log(`✅ Token: ${session.token ? session.token.slice(0, 10) + '...' : '无'}`);
  
  if (!session.token) {
    console.log('⚠️ 未找到 _m_h5_tk token，部分API可能无法调用');
  }
  
  // 2. 根据参数调用API
  if (userId) {
    console.log(`\n📌 查询店铺商品列表: userId=${userId}`);
    console.log('  调用 mtop.idle.web.xyh.item.list...\n');
    
    try {
      const result = await callMTOP(
        'idle.web.xyh.item.list',
        { pageNumber: 1, userId, pageSize: 30 },
        session.cookies,
        session.token
      );
      
      const ret = result.ret?.[0] || '';
      console.log(`  响应状态: ${ret}`);
      
      if (ret.startsWith('SUCCESS')) {
        const items = parseItemsFromXyhList(result.data);
        console.log(`\n  📦 共 ${items.length} 个商品:\n`);
        items.forEach((item, i) => {
          console.log(`  ${i+1}. ${item.title.slice(0, 40).padEnd(42)} ¥${item.price || '?'}`);
        });
        
        if (items.length > 0) {
          console.log(`\n  ✅ 店铺ID验证成功！`);
          console.log(`  📋 监控命令: node shop_monitor_v2.mjs --userId=${userId}`);
          
          // 也尝试查商品详情（看5维数据）
          if (items[0].itemId) {
            console.log(`\n📌 试查商品详情 (获取5维数据)...`);
            try {
              const detail = await callMTOP(
                'taobao.idle.pc.detail',
                { id: items[0].itemId },
                session.cookies,
                session.token
              );
              const d = parseItemDetail(detail.data);
              if (d) {
                console.log(`  ✅ 商品: ${d.title.slice(0, 30)}`);
                console.log(`     👁浏览=${d.views} ❤️想要=${d.wants} ⭐收藏=${d.favorites} 💬留言=${d.comments} 📝评价=${d.reviews}`);
                console.log(`     卖家: ${d.sellerName} (ID: ${d.sellerId})`);
              }
            } catch(e) {
              console.log(`  ⚠️ 详情查询: ${e.message}`);
            }
          }
        }
      } else {
        console.log(`  ❌ API返回错误: ${ret}`);
        console.log(`  完整响应: ${JSON.stringify(result).slice(0, 300)}`);
      }
    } catch(e) {
      console.log(`  ❌ 调用失败: ${e.message}`);
    }
    
  } else if (itemId) {
    console.log(`\n📌 查询商品详情: itemId=${itemId}`);
    console.log('  调用 mtop.taobao.idle.pc.detail...\n');
    
    try {
      const result = await callMTOP(
        'taobao.idle.pc.detail',
        { id: itemId },
        session.cookies,
        session.token
      );
      
      const ret = result.ret?.[0] || '';
      console.log(`  响应状态: ${ret}`);
      
      if (ret.startsWith('SUCCESS')) {
        const detail = parseItemDetail(result.data);
        if (detail) {
          console.log(`\n  ✅ 商品详情:`);
          console.log(`  标题: ${detail.title}`);
          console.log(`  价格: ¥${detail.price}`);
          console.log(`  浏览: ${detail.views}`);
          console.log(`  想要: ${detail.wants}`);
          console.log(`  收藏: ${detail.favorites}`);
          console.log(`  留言: ${detail.comments}`);
          console.log(`  评价: ${detail.reviews}`);
          console.log(`  卖家: ${detail.sellerName} (ID: ${detail.sellerId})`);
          
          if (detail.sellerItems?.length > 0) {
            console.log(`\n  该卖家还有 ${detail.sellerItems.length} 个在售商品:`);
            detail.sellerItems.slice(0, 5).forEach(si => {
              console.log(`    - ${si.title?.slice(0, 40) || '?'} ¥${si.price || '?'}`);
            });
            console.log(`\n  📋 监控店铺: node shop_monitor_v2.mjs --userId=${detail.sellerId}`);
          }
        }
      } else {
        console.log(`  ❌ API错误: ${ret}`);
      }
    } catch(e) {
      console.log(`  ❌ 调用失败: ${e.message}`);
    }
  } else {
    console.log('\n用法:');
    console.log('  node direct_api.mjs --userId=店铺ID    # 查店铺商品');
    console.log('  node direct_api.mjs --item=商品ID       # 查商品5维数据');
  }
}

main().catch(e => console.error('❌ 错误:', e.message));
