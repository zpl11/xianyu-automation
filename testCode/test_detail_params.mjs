/**
 * 测试不同参数组合调用 pc.detail API
 * 从 FAIL_BIZ_PARAM_ERROR 找正确的参数格式
 */
import http from 'http'; import https from 'https'; import WebSocket from 'ws'; import crypto from 'crypto'; import { URLSearchParams } from 'url';

const CDP_PORT = 9222; const APP_KEY = '34839810'; const ITEM = '1061901376412';

async function getCookies() {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json`));
  const page = targets.find(t => (t.url||'').includes('goofish.com') && !t.url.includes('g.alicdn'));
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.on('open', r));
  let id = 1; const p = new Map();
  ws.on('message', d => { try { const m = JSON.parse(d.toString()); if (m.id) { const h = p.get(m.id); if (h) { clearTimeout(h.t); p.delete(m.id); h.r(m); } } } catch(e) {} });
  const s = (m, par) => new Promise(r => { const i = id++; p.set(i, { r, t: setTimeout(() => { p.delete(i); r({}); }, 8000) }); ws.send(JSON.stringify({ id: i, method: m, params: par })); });
  await s('Network.enable'); await sleep(300);
  const ck = await s('Network.getAllCookies'); ws.close();
  const all = ck.result?.cookies || [];
  const keyNames = ['_m_h5_tk','_m_h5_tk_enc','x5sec','_tb_token_','cookie2','t','cna','tracknick','unb','sgcookie','tfstk','isg','l','csg','xlly_s','sca'];
  return { cookieStr: all.filter(c => keyNames.includes(c.name)).map(c => c.name+'='+c.value).join('; '), token: (all.find(c => c.name === '_m_h5_tk')?.value || '').split('_')[0] };
}

async function call(data, cookies, token) {
  const ts = Date.now();
  const dataStr = JSON.stringify(data);
  const sign = crypto.createHash('md5').update(token + '&' + ts + '&' + APP_KEY + '&' + dataStr).digest('hex');
  const url = 'https://h5api.m.goofish.com/h5/mtop.taobao.idle.pc.detail/1.0/?' + new URLSearchParams({jsv:'2.7.2',appKey:APP_KEY,t:String(ts),sign,v:'1.0',type:'originaljson',api:'mtop.taobao.idle.pc.detail',dataType:'json',timeout:'20000',accountSite:'xianyu',sessionOption:'AutoLoginOnly',spm_cnt:'a21ybx.item.0.0'});
  return new Promise(r => {
    const bd = 'data=' + encodeURIComponent(dataStr);
    const req = https.request(url, { method:'POST', headers:{'Cookie':cookies,'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(bd),'Origin':'https://www.goofish.com','Referer':'https://www.goofish.com/','User-Agent':'Mozilla/5.0'}}, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { try { const m = b.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s); r(m ? JSON.parse(m[1]) : JSON.parse(b)); } catch(e) { r({raw:b.slice(0,100)}); } });
    }); req.write(bd); req.end();
  });
}

async function main() {
  const { cookieStr, token } = await getCookies();
  console.log('Token:', token.slice(0,10) + '...');
  console.log('Cookie:', cookieStr.length + ' chars\n');
  
  // 浏览器实际调用的参数（通过CDP捕获到的）
  const browserData = { id: ITEM, returnItemDO: true, needSellerDO: true };
  console.log('1. 浏览器参数:', JSON.stringify(browserData));
  let r = await call(browserData, cookieStr, token);
  console.log('   →', (r.ret?.[0] || '').slice(0, 60));
  
  // 简化参数
  const tests = [
    { id: ITEM },
    { id: Number(ITEM) },
    { itemId: ITEM },
    { 'id': ITEM, 'returnItemDO': true },
    { 'id': ITEM, 'needSellerDO': true },
    { 'id': ITEM, 'returnItemDO': true, 'needSellerDO': true },
    { 'id': String(ITEM), 'returnItemDO': 'true', 'needSellerDO': 'true' },
  ];
  
  for (const t of tests) {
    console.log('2.', JSON.stringify(t).slice(0, 60));
    r = await call(t, cookieStr, token);
    console.log('   →', (r.ret?.[0] || '').slice(0, 60));
    await sleep(300);
  }
  
  process.exit(0);
}

function httpGet(url) { return new Promise(r => { http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error(e); process.exit(1); });
