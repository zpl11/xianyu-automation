import http from 'http';
import crypto from 'crypto';
import WebSocket from 'ws';
import { URLSearchParams } from 'url';
import fs from 'fs';

const CDP_PORT = 9222;
const APP_KEY = '34839810';

let _session = { cookies: '', token: '', valid: false };

function httpGet(url) { 
  return new Promise(r => { 
    const req = http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); });
    req.on('error', () => r(''));
    req.setTimeout(5000, () => { req.destroy(); r(''); });
  }); 
}

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
  } catch(e) { return false; }
}

async function callMTOP(apiName, data, extraParams = {}) {
  const ts = Date.now();
  const dataStr = JSON.stringify(data);
  const sign = crypto.createHash('md5').update(`${_session.token}&${ts}&${APP_KEY}&${dataStr}`).digest('hex');
  const params = { jsv: '2.7.2', appKey: APP_KEY, t: String(ts), sign, v: '1.0', type: 'originaljson', api: `mtop.${apiName}`, dataType: 'json', timeout: '20000', accountSite: 'xianyu', sessionOption: 'AutoLoginOnly', ...extraParams };
  const url = `https://h5api.m.goofish.com/h5/mtop.${apiName}/1.0/?${new URLSearchParams(params)}`;
  
  const bd = `data=${encodeURIComponent(dataStr)}`;
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
    body: bd
  });
  const body = await res.text();
  const m = body.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
  return m ? JSON.parse(m[1]) : JSON.parse(body);
}

async function testFetch() {
  await refreshSession();
  const userId = '1941483402'; // specific user
  
  let allCards = [];
  const seenIds = new Set();
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
  
  let firstPageRes = await callMTOP('idle.web.xyh.item.list', { needGroupInfo: true, pageNumber: 1, userId, pageSize: 20 }, { spm_cnt: 'a21ybx.personal.0.0' });
  processCards(firstPageRes.data);
  let hasMore = firstPageRes.data.nextPage;
  let currentPage = 2;
  
  // Sequential fetch without cursors, to avoid concurrency issues!
  while (hasMore && currentPage <= 50) {
    let p = currentPage++;
    console.log(`Fetching page ${p}...`);
    let r = await callMTOP('idle.web.xyh.item.list', { needGroupInfo: true, pageNumber: p, userId, pageSize: 20 }, { spm_cnt: 'a21ybx.personal.0.0' }).catch(e => null);
    
    if (r && r.data) {
       processCards(r.data);
       if (r.data.nextPage === false || !r.data.cardList || r.data.cardList.length === 0) {
          hasMore = false;
       }
    } else {
       console.log(`Page ${p} failed, retrying once...`);
       await new Promise(res => setTimeout(res, 1000));
       r = await callMTOP('idle.web.xyh.item.list', { needGroupInfo: true, pageNumber: p, userId, pageSize: 20 }, { spm_cnt: 'a21ybx.personal.0.0' }).catch(e => null);
       if (r && r.data) {
           processCards(r.data);
           if (r.data.nextPage === false || !r.data.cardList || r.data.cardList.length === 0) hasMore = false;
       } else {
           console.log(`Page ${p} failed again. Stopping.`);
           hasMore = false;
       }
    }
  }
  
  console.log(`Unique Cards Fetched: ${allCards.length}`);
  fs.writeFileSync('cards_dump.json', JSON.stringify(allCards, null, 2));
}
testFetch();
