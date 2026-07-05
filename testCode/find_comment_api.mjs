/**
 * 搜索可能包含留言/互动数据的 API
 */
import http from 'http'; import https from 'https'; import WebSocket from 'ws'; import crypto from 'crypto'; import { URLSearchParams } from 'url';
const APP_KEY = '34839810'; const CDP_PORT = 9222;

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
  const keyNames = ['_m_h5_tk','_m_h5_tk_enc','x5sec','_tb_token_','cookie2','t','cna','tracknick','unb','sgcookie','tfstk','isg','l','csg','xlly_s','sca'];
  const cs = all.filter(c => keyNames.includes(c.name)).map(c => c.name+'='+c.value).join('; ');
  const token = (all.find(c => c.name === '_m_h5_tk')?.value || '').split('_')[0];

  const apis = [
    'mtop.taobao.idle.item.interact.count',
    'mtop.taobao.idle.comment.count',
    'mtop.taobao.idle.message.count',
    'mtop.taobao.idle.item.comment.list',
    'mtop.taobao.idle.item.interact',
    'mtop.taobao.idle.comment.list',
    'mtop.taobao.idle.item.consult.count',
    'mtop.taobao.idle.item.chat.count',
    'mtop.taobao.idle.item.msg.count',
  ];

  for (const api of apis) {
    try {
      const ts = Date.now();
      const ds = JSON.stringify({ itemId: '1054944275429' });
      const sign = crypto.createHash('md5').update(token+'&'+ts+'&'+APP_KEY+'&'+ds).digest('hex');
      const url = 'https://h5api.m.goofish.com/h5/'+api+'/1.0/?'+new URLSearchParams({jsv:'2.7.2',appKey:APP_KEY,t:String(ts),sign,v:'1.0',type:'originaljson',api:api,dataType:'json',timeout:'10000',accountSite:'xianyu',sessionOption:'AutoLoginOnly'});
      const r = await new Promise(r2 => {
        const bd='data='+encodeURIComponent(ds);
        const req=https.request(url,{method:'POST',headers:{'Cookie':cs,'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(bd)}},res=>{
          let b='';res.on('data',c=>b+=c);res.on('end',()=>{try{const m2=b.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);r2(m2?JSON.parse(m2[1]):JSON.parse(b))}catch(e){r2({})}});
        });req.write(bd);req.end();
      });
      const ret = (r.ret?.[0] || 'NO_RET').slice(0, 40);
      if (ret.includes('SUCCESS')) {
        const data = r.data || {};
        console.log('✅', api, '|', ret, '| keys:', Object.keys(data).slice(0,8).join(','));
      } else if (!ret.includes('NOT_FOUNDED')) {
        console.log('   ', api, '|', ret);
      }
    } catch(e) {}
    await sleep(200);
  }
  process.exit(0);
}

function httpGet(url) { return new Promise(r => { http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e => { console.error(e); process.exit(1); });
