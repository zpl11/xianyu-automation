/**
 * 检查搜索API和列表API返回的数据中是否包含统计信息
 */
import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import crypto from 'crypto';
import { URLSearchParams } from 'url';

const CDP_PORT = 9222;
const APP_KEY = '34839810';

async function getSession() {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json`));
  const t = targets.find(t => (t.url || '').includes('goofish.com'));
  const ws = await wsConnect(t.webSocketDebuggerUrl);
  await wsSend(ws, 'Network.enable');
  await sleep(300);
  const ck = await wsSend(ws, 'Network.getAllCookies');
  ws.close();
  const all = ck.result?.cookies || [];
  const domains = ['.goofish.com', '.taobao.com', '.tmall.com', '.tb.cn', 'h5api.m.goofish.com', 'passport.goofish.com'];
  const filtered = all.filter(c => domains.some(d => c.domain.includes(d)));
  const cookieStr = filtered.map(c => `${c.name}=${c.value}`).join('; ');
  const tkCookie = all.find(c => c.name === '_m_h5_tk');
  const token = tkCookie ? tkCookie.value.split('_')[0] : '';
  return { cookies: cookieStr, token };
}

function callAPI(apiName, data, cookies, token, extraParams = {}) {
  const ts = Date.now();
  const dataStr = JSON.stringify(data);
  const sign = crypto.createHash('md5').update(`${token}&${ts}&${APP_KEY}&${dataStr}`).digest('hex');
  
  const params = {
    jsv: '2.7.2', appKey: APP_KEY, t: String(ts), sign, v: '1.0',
    type: 'originaljson', api: `mtop.${apiName}`,
    dataType: 'json', timeout: '20000', accountSite: 'xianyu',
    sessionOption: 'AutoLoginOnly', ...extraParams,
  };
  
  const url = `https://h5api.m.goofish.com/h5/mtop.${apiName}/1.0/?${new URLSearchParams(params)}`;
  
  return new Promise((resolve, reject) => {
    https.request(url, { method: 'POST', headers: { 'Cookie': cookies, 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'https://www.goofish.com', 'Referer': 'https://www.goofish.com/', 'User-Agent': 'Mozilla/5.0' }}, (res) => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => {
        const m = b.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
        resolve(m ? JSON.parse(m[1]) : { raw: b.slice(0, 200) });
      });
    }).on('error', reject).end(`data=${encodeURIComponent(dataStr)}`);
  });
}

async function main() {
  const session = await getSession();
  console.log('会话获取成功\n');
  
  // 1. 搜索API - 搜索包含商品ID
  console.log('=== 搜索API (mtop.taobao.idlemtopsearch.pc.search) ===');
  const itemId = '1061901376412';
  try {
    const result = await callAPI('taobao.idlemtopsearch.pc.search', {
      pageNumber: 1, keyword: 'Codex', fromFilter: false, rowsPerPage: 30,
      sortValue: '', sortField: '', customDistance: '', gps: '',
      propValueStr: {}, customGps: '',
      searchReqFromPage: 'pcSearch', extraFilterValue: '{}', userPositionJson: '{}',
    }, session.cookies, session.token, { spm_cnt: 'a21ybx.search.0.0' });
    
    const ret = result.ret?.[0] || '';
    console.log(`ret: ${ret.slice(0, 60)}`);
    
    if (ret.startsWith('SUCCESS')) {
      const list = result.data?.resultList || [];
      console.log(`结果数: ${list.length}`);
      for (const item of list.slice(0, 5)) {
        const main = item?.data?.item?.main || {};
        const args = main.clickParam?.args || {};
        const ex = main.exContent || {};
        let title = '';
        if (ex.richTitle) title = ex.richTitle.map(t => t?.data?.text || '').join('');
        console.log(`  [${args.id}] ${(title || args.title || '').slice(0, 30).padEnd(32)} price=${args.price} wantNum=${args.wantNum}`);
      }
    } else {
      console.log(`失败: ${JSON.stringify(result).slice(0, 200)}`);
    }
  } catch(e) { console.log('错误: ' + e.message); }
  
  // 2. 店铺列表API - 检查cardData详情
  console.log('\n=== 店铺列表API - cardData详情 ===');
  try {
    const result = await callAPI('idle.web.xyh.item.list', {
      needGroupInfo: true, pageNumber: 1, userId: '2217571424592', pageSize: 20,
    }, session.cookies, session.token, { spm_cnt: 'a21ybx.personal.0.0' });
    
    const cards = result.data?.cardList || [];
    console.log(`卡片数: ${cards.length}`);
    if (cards.length > 0) {
      const cd = cards[0].cardData || {};
      console.log(`\n第一个cardData完整字段:`);
      for (const [k, v] of Object.entries(cd)) {
        if (typeof v === 'object') {
          console.log(`  ${k}: ${JSON.stringify(v).slice(0, 200)}`);
        } else {
          console.log(`  ${k}: ${v}`);
        }
      }
    }
  } catch(e) { console.log('错误: ' + e.message); }
  
  // 3. 首页Feed API
  console.log('\n=== 首页Feed API (mtop.taobao.idlehome.home.webpc.feed) ===');
  try {
    const result = await callAPI('taobao.idlehome.home.webpc.feed', {
      pageNumber: 1, pageSize: 10,
    }, session.cookies, session.token, { spm_cnt: 'a21ybx.home.0.0' });
    
    const ret = result.ret?.[0] || '';
    console.log(`ret: ${ret.slice(0, 60)}`);
    if (ret.startsWith('SUCCESS')) {
      const keys = Object.keys(result.data || {});
      console.log(`data keys: ${JSON.stringify(keys)}`);
    } else {
      console.log(`失败: ${JSON.stringify(result).slice(0, 200)}`);
    }
  } catch(e) { console.log('错误: ' + e.message); }
}

function httpGet(url) { return new Promise(r => { http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }); }); }
function wsConnect(url) { return new Promise(r => { const w = new WebSocket(url); w.on('open', () => r(w)); }); }
function wsSend(ws, method, params = {}) { return new Promise(r => { const id = Date.now() % 100000; const handler = (data) => { const msg = JSON.parse(data.toString()); if (msg.id === id) { ws.removeListener('message', handler); r(msg); } }; ws.on('message', handler); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { ws.removeListener('message', handler); r({}); }, 8000); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => console.error(e));
