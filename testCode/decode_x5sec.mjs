/**
 * 尝试解码 x5sec 并刷新 token
 */
import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import crypto from 'crypto';
import { URLSearchParams } from 'url';

const CDP_PORT = 9222;
const APP_KEY = '34839810';

async function getSessionFromChrome() {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json`));
  const t = targets.find(t => (t.url || '').includes('goofish.com'));
  const ws = await wsConnect(t.webSocketDebuggerUrl);
  await wsSend(ws, 'Network.enable');
  await sleep(300);
  const ck = await wsSend(ws, 'Network.getAllCookies');
  ws.close();
  const all = ck.result?.cookies || [];
  const filtered = all.filter(c => ['.goofish.com','.taobao.com','.tb.cn','h5api.m.goofish.com','passport.goofish.com'].some(d => c.domain.includes(d)));
  const cookieStr = filtered.map(c => `${c.name}=${c.value}`).join('; ');
  const token = (all.find(c => c.name === '_m_h5_tk')?.value || '').split('_')[0];
  return { cookies: cookieStr, token, all };
}

async function callDetailAPI(cookies, token, itemId) {
  const ts = Date.now();
  const data = { id: String(itemId), returnItemDO: true, needSellerDO: true };
  const dataStr = JSON.stringify(data);
  const sign = crypto.createHash('md5').update(`${token}&${ts}&${APP_KEY}&${dataStr}`).digest('hex');
  
  const params = {
    jsv: '2.7.2', appKey: APP_KEY, t: String(ts), sign, v: '1.0',
    type: 'originaljson', api: 'mtop.taobao.idle.pc.detail',
    dataType: 'json', timeout: '20000', accountSite: 'xianyu',
    sessionOption: 'AutoLoginOnly', spm_cnt: 'a21ybx.item.0.0',
  };
  
  const url = `https://h5api.m.goofish.com/h5/mtop.taobao.idle.pc.detail/1.0/?${new URLSearchParams(params)}`;
  
  return new Promise(r => {
    const req = https.request(url, { method: 'POST', headers: {
      'Cookie': cookies, 'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': 'https://www.goofish.com', 'Referer': 'https://www.goofish.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    }}, (res) => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => {
        const m = b.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
        r(m ? JSON.parse(m[1]) : { raw: b.slice(0, 500) });
      });
    });
    req.write(`data=${encodeURIComponent(dataStr)}`); req.end();
  });
}

async function main() {
  const session = await getSessionFromChrome();
  const itemId = '1061901376412';
  const shopUserId = '2217571424592';
  
  // Step 1: 先调用一次 detail API，拿到 punish URL
  console.log('1. 调用 detail API (预期失败)...');
  const result1 = await callDetailAPI(session.cookies, session.token, itemId);
  const ret1 = result1.ret?.[0] || '';
  console.log(`   ret: ${ret1.slice(0, 60)}`);
  
  const punishUrl = result1.data?.url || '';
  if (punishUrl) {
    console.log(`   punishUrl: ${punishUrl.slice(0, 150)}...`);
    
    // Step 2: 访问 punish URL（这可能会刷新 x5sec cookie）
    console.log('\n2. 访问 punish URL 刷新 x5sec...');
    try {
      const punishResult = await new Promise(r => {
        https.get(punishUrl, { headers: { 'Cookie': session.cookies, 'User-Agent': 'Mozilla/5.0' }}, (res) => {
          let b = ''; res.on('data', c => b += c);
          res.on('end', () => r({ status: res.statusCode, headers: res.headers, body: b.slice(0, 500) }));
        }).on('error', e => r({ error: e.message }));
      });
      console.log(`   punish status: ${punishResult.status}`);
      console.log(`   set-cookie: ${(punishResult.headers['set-cookie'] || []).join(', ').slice(0, 200)}`);
    } catch(e) {
      console.log(`   punish error: ${e.message}`);
    }
  }
  
  // Step 3: 重新获取cookie看看x5sec有没有更新
  if (punishUrl) {
    console.log('\n3. 重新获取cookie检查x5sec是否更新...');
    const session2 = await getSessionFromChrome();
    const oldX5 = session.all.find(c => c.name === 'x5sec')?.value || '';
    const newX5 = session2.all.find(c => c.name === 'x5sec')?.value || '';
    console.log(`   旧x5sec: ${oldX5.slice(0, 40)}...`);
    console.log(`   新x5sec: ${newX5.slice(0, 40)}...`);
    console.log(`   是否变化: ${oldX5 !== newX5 ? '✅ 已更新' : '❌ 未变化'}`);
    
    // Step 4: 用新cookie再试
    if (oldX5 !== newX5) {
      console.log('\n4. 用新x5sec重试 detail API...');
      const result2 = await callDetailAPI(session2.cookies, session2.token, itemId);
      const ret2 = result2.ret?.[0] || '';
      console.log(`   ret: ${ret2.slice(0, 60)}`);
      if (ret2.startsWith('SUCCESS')) {
        const item = result2.data?.itemDO || {};
        console.log(`   标题: ${item.title}`);
        console.log(`   浏览: ${item.browseCnt}`);
        console.log(`   想要: ${item.wantCnt}`);
      }
    }
  }
  
  // 尝试其他API获取数据
  console.log('\n5. 尝试调用其他可能包含统计数据的API...');
  
  // 5a. 尝试 mt Rain API (同域名的其他端点)
  for (const apiPath of ['mtop.taobao.idle.item.evaluate.list', 'mtop.taobao.idle.item.interact.count', 'mtop.taobao.idle.item.stat']) {
    try {
      const ts = Date.now();
      const data = { itemId };
      const dataStr = JSON.stringify(data);
      const sign = crypto.createHash('md5').update(`${session.token}&${ts}&${APP_KEY}&${dataStr}`).digest('hex');
      const url = `https://h5api.m.goofish.com/h5/${apiPath}/1.0/?${new URLSearchParams({jsv:'2.7.2',appKey:APP_KEY,t:String(ts),sign,v:'1.0',type:'originaljson',api:apiPath,dataType:'json',timeout:'20000',accountSite:'xianyu',sessionOption:'AutoLoginOnly'})}`;
      
      const res = await new Promise(r => {
        https.request(url, { method: 'POST', headers: { 'Cookie': session.cookies, 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'https://www.goofish.com', 'Referer': 'https://www.goofish.com/' }}, (resp) => {
          let b = ''; resp.on('data', c => b += c);
          resp.on('end', () => {
            const m = b.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
            r(m ? JSON.parse(m[1]) : { raw: b.slice(0, 100) });
          });
        }).on('error', e => r({ error: e.message })).end(`data=${encodeURIComponent(dataStr)}`);
      });
      
      console.log(`   ${apiPath}: ${(res.ret?.[0] || '?').slice(0, 50)}`);
    } catch(e) {
      console.log(`   ${apiPath}: error`);
    }
  }
  
  process.exit(0);
}

function httpGet(url) { return new Promise(r => { http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }); }); }
function wsConnect(url) { return new Promise(r => { const w = new WebSocket(url); w.on('open', () => r(w)); }); }
function wsSend(ws, method, params = {}) { return new Promise(r => { const id = Date.now() % 100000; const handler = (data) => { const msg = JSON.parse(data.toString()); if (msg.id === id) { ws.removeListener('message', handler); r(msg); } }; ws.on('message', handler); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { ws.removeListener('message', handler); r({}); }, 8000); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => console.error(e));
