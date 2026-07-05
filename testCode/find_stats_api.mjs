/**
 * 探索能获取商品统计数据（浏览/想要/收藏）的API
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
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 1; const p = new Map();
  ws.on('message', (d) => { try { const m = JSON.parse(d.toString()); if (m.id) { const h = p.get(m.id); if (h) { clearTimeout(h.t); p.delete(m.id); h.r(m); } } } catch(e) {} });
  const s = (m, par) => new Promise(r => { const i = id++; p.set(i, { r, t: setTimeout(() => { p.delete(i); r({}); }, 8000) }); ws.send(JSON.stringify({ id: i, method: m, params: par })); });
  await s('Network.enable'); await sleep(300);
  const ck = await s('Network.getAllCookies'); ws.close();
  const all = ck.result?.cookies || [];
  const keep = all.filter(c => ['.goofish.com','.taobao.com','.tb.cn','h5api.m.goofish.com','passport.goofish.com'].some(d => c.domain.includes(d)));
  const cookieStr = keep.map(c => `${c.name}=${c.value}`).join('; ');
  const token = (all.find(c => c.name === '_m_h5_tk')?.value || '').split('_')[0];
  return { cookies: cookieStr, token };
}

async function call(method, apiName, data) {
  const s = await getSession();
  const ts = Date.now();
  const dataStr = JSON.stringify(data);
  const sign = crypto.createHash('md5').update(`${s.token}&${ts}&${APP_KEY}&${dataStr}`).digest('hex');
  const url = `https://h5api.m.goofish.com/h5/${apiName}/1.0/?${new URLSearchParams({jsv:'2.7.2',appKey:APP_KEY,t:String(ts),sign,v:'1.0',type:'originaljson',api:apiName,dataType:'json',timeout:'20000',accountSite:'xianyu',sessionOption:'AutoLoginOnly'})}`;
  return new Promise(r => {
    const req = https.request(url, {method,headers:{'Cookie':s.cookies,'Content-Type':'application/x-www-form-urlencoded','Origin':'https://www.goofish.com','Referer':'https://www.goofish.com/','User-Agent':'Mozilla/5.0'}}, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const m = b.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
          r(m ? JSON.parse(m[1]) : JSON.parse(b));
        } catch(e) {
          r({ raw: b.slice(0, 200) });
        }
      });
    });
    if (method === 'POST') { req.write(`data=${encodeURIComponent(dataStr)}`); }
    req.end();
  });
}

async function main() {
  const itemId = '1061901376412';
  
  // 1. 搜索API - 搜索这个商品标题
  console.log('1. 搜索API (mtop.taobao.idlemtopsearch.pc.search)');
  const r1 = await call('POST', 'mtop.taobao.idlemtopsearch.pc.search', { pageNumber:1, keyword:'Codex从入门到精通', fromFilter:false, rowsPerPage:30, sortValue:'', sortField:'', customDistance:'', gps:'', propValueStr:{}, customGps:'', searchReqFromPage:'pcSearch', extraFilterValue:'{}', userPositionJson:'{}' });
  const ret1 = r1.ret?.[0] || '';
  console.log(`  ret: ${ret1.slice(0, 50)}`);
  if (ret1.startsWith('SUCCESS')) {
    const list = r1.data?.resultList || [];
    console.log(`  结果数: ${list.length}`);
    for (const item of list.slice(0, 3)) {
      const args = item?.data?.item?.main?.clickParam?.args || {};
      console.log(`  [${args.id}] wantNum=${args.wantNum} price=${args.price} browseCnt=${args.browseCnt}`);
    }
  } else {
    console.log(`  ${JSON.stringify(r1).slice(0, 200)}`);
  }
  
  // 2. itemGroupList 分析 - 看看有没有统计数据
  console.log('\n2. xyh.item.list - itemGroupList 分析');
  const r2 = await call('POST', 'mtop.idle.web.xyh.item.list', { needGroupInfo:true, pageNumber:1, userId:'2221400994666', pageSize:20 });
  if (r2.ret?.[0]?.startsWith('SUCCESS')) {
    const groups = r2.data?.itemGroupList || [];
    console.log(`  itemGroupList: ${groups.length} 个分组`);
    for (const g of groups.slice(0, 2)) {
      const items = g.groupSortList || [];
      console.log(`  分组 "${g.groupName}": ${items.length} 个商品`);
      if (items.length > 0) {
        const first = items[0];
        console.log(`  [0] keys: ${Object.keys(first).slice(0, 15).join(', ')}`);
        if (first.wantCnt) console.log(`      wantCnt=${first.wantCnt}`);
        if (first.browseCnt) console.log(`      browseCnt=${first.browseCnt}`);
      }
    }
  } else {
    console.log(`  ret: ${(r2.ret?.[0] || '').slice(0, 60)}`);
  }
  
  // 3. 尝试 pc.detail 但不带敏感参数
  console.log('\n3. pc.detail (简单请求)');
  const r3 = await call('POST', 'mtop.taobao.idle.pc.detail', { id: itemId });
  const ret3 = r3.ret?.[0] || '';
  console.log(`  ret: ${ret3.slice(0, 60)}`);
  if (ret3.startsWith('SUCCESS')) {
    const item = r3.data?.itemDO || {};
    console.log(`  title: ${item.title}`);
    console.log(`  browseCnt: ${item.browseCnt}, wantCnt: ${item.wantCnt}, collectCnt: ${item.collectCnt}`);
    console.log(`  interactFavorCnt: ${item.interactFavorCnt}, evaluateCnt: ${item.evaluateCnt}`);
  }
  
  // 4. 尝试批量统计API
  console.log('\n4. 尝试批量查询API');
  const apis = [
    ['mtop.taobao.idle.item.interact.count', { itemIdList: [itemId] }],
    ['mtop.taobao.idle.item.stat.get', { itemIds: [itemId] }],
    ['mtop.taobao.idle.item.aggregation', { itemId }],
  ];
  for (const [api, data] of apis) {
    const r = await call('POST', api, data);
    const ret = r.ret?.[0] || r.raw || '?';
    console.log(`  ${api}: ${String(ret).slice(0, 80)}`);
    if (typeof r === 'object' && r.data) {
      console.log(`    data keys: ${Object.keys(r.data).slice(0, 10).join(', ')}`);
    }
  }
  
  process.exit(0);
}

function httpGet(url) { return new Promise(r => { http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error(e); process.exit(1); });
