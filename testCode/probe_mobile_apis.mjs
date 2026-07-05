/**
 * 探测闲鱼移动端可能使用的 API
 * Web API 是 mtop.taobao.idle.pc.detail
 * 移动端可能使用不同的 API 名称
 */
import http from 'http'; import https from 'https'; import WebSocket from 'ws'; import crypto from 'crypto'; import { URLSearchParams } from 'url';
const APP_KEY = '34839810'; const CDP_PORT = 9222; const ITEM = '1054944275429';

async function main() {
  const targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json`));
  const page = targets.find(t => (t.url||'').includes('goofish.com') && !t.url.includes('g.alicdn'));
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.on('open', r));
  let id = 1; const m = new Map();
  ws.on('message', d => { try { const j = JSON.parse(d.toString()); if (j.id) { const h = m.get(j.id); if (h) { clearTimeout(h.t); m.delete(j.id); h.r(j); } } } catch(e) {} });
  const s = (m2, par) => new Promise(r => { const i = id++; m.set(i, { r, t: setTimeout(() => { m.delete(i); r({}); }, 8000) }); ws.send(JSON.stringify({ id: i, method: m2, params: par })); });
  await s('Network.enable'); await sleep(300);
  const ck = await s('Network.getAllCookies'); ws.close();
  const all = ck.result?.cookies || [];
  const filtered = all.filter(c => ['.goofish.com','.taobao.com','.tb.cn','h5api.m.goofish.com','passport.goofish.com'].some(d => c.domain.includes(d)));
  const cs = filtered.map(c => c.name+'='+c.value).join('; ');
  const token = (all.find(c => c.name === '_m_h5_tk')?.value || '').split('_')[0];
  console.log(`Cookies: ${filtered.length} items, Token: ${token.slice(0,8)}...\n`);

  // 探测不同的移动端 API
  const apis = [
    // Web 版已知
    { name: 'taobao.idle.pc.detail', data: { itemId: ITEM } },
    // 可能的移动版
    { name: 'taobao.idle.item.detail', data: { itemId: ITEM } },
    { name: 'taobao.idle.item.get', data: { itemId: ITEM } },
    { name: 'taobao.idle.item.fullDetail', data: { itemId: ITEM } },
    { name: 'taobao.idle.detail', data: { id: ITEM } },
    { name: 'taobao.idle.item.detail', data: { id: ITEM } },
    { name: 'taobao.idle.item.mobile.detail', data: { itemId: ITEM } },
    { name: 'taobao.idle.item.app.detail', data: { itemId: ITEM } },
    // 不同版本
    { name: 'taobao.idle.pc.detail', data: { itemId: ITEM }, ver: '2.0' },
    { name: 'taobao.idle.pc.detail', data: { itemId: ITEM }, ver: '3.0' },
  ];

  for (const api of apis) {
    try {
      const ts = Date.now(); const ds = JSON.stringify(api.data);
      const sign = crypto.createHash('md5').update(token+'&'+ts+'&'+APP_KEY+'&'+ds).digest('hex');
      const ver = api.ver || '1.0';
      const url = `https://h5api.m.goofish.com/h5/mtop.${api.name}/${ver}/?${new URLSearchParams({jsv:'2.7.2',appKey:APP_KEY,t:String(ts),sign,v:ver,type:'originaljson',api:`mtop.${api.name}`,dataType:'json',timeout:'10000',accountSite:'xianyu',sessionOption:'AutoLoginOnly'})}`;
      const r = await new Promise(r2 => {
        const bd='data='+encodeURIComponent(ds);
        const req=https.request(url,{method:'POST',headers:{'Cookie':cs,'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(bd)}},res=>{
          let b='';res.on('data',c=>b+=c);res.on('end',()=>{try{const m2=b.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);r2(m2?JSON.parse(m2[1]):JSON.parse(b))}catch(e){r2({})}});
        });req.write(bd);req.end();
      });
      const ret = (r.ret?.[0] || '').slice(0, 50);
      if (ret.startsWith('SUCCESS')) {
        const item = r.data?.itemDO || r.data?.item || r.data?.b2cItemDO || {};
        const allKeys = Object.keys(r.data||{});
        const commentKeys = allKeys.filter(k => /comment|interact|msg|reply|chat|talk/i.test(k));
        const numFields = Object.entries(item).filter(([k,v]) => typeof v === 'number' && v > 0).map(([k,v]) => `${k}=${v}`);
        console.log(`✅ ${api.name} v${ver} | 顶层含留言字段: ${commentKeys.join(',') || '无'} | 数值: ${numFields.join(', ') || '无'}`);
      } else if (ret.includes('NOT_FOUNDED')) {
        // skip - API不存在
      } else {
        console.log(`   ${api.name} v${ver}: ${ret.slice(0, 40)}`);
      }
    } catch(e) {}
    await sleep(150);
  }
  process.exit(0);
}

function httpGet(url) { return new Promise(r => { http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e => { console.error(e); process.exit(1); });
