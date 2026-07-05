/**
 * 查找 pc.detail API 中留言/评论数的字段名
 */
import http from 'http'; import https from 'https'; import WebSocket from 'ws'; import crypto from 'crypto'; import { URLSearchParams } from 'url';
const APP_KEY = '34839810'; const CDP_PORT = 9222; const ITEM_ID = '1054944275429';  // 用户说有留言的商品

async function main() {
  // 获取cookies
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
  
  // 调用 pc.detail
  const ts = Date.now();
  const ds = JSON.stringify({itemId: ITEM_ID});
  const sign = crypto.createHash('md5').update(token+'&'+ts+'&'+APP_KEY+'&'+ds).digest('hex');
  const url = 'https://h5api.m.goofish.com/h5/mtop.taobao.idle.pc.detail/1.0/?'+new URLSearchParams({jsv:'2.7.2',appKey:APP_KEY,t:String(ts),sign,v:'1.0',type:'originaljson',api:'mtop.taobao.idle.pc.detail',dataType:'json',timeout:'20000',accountSite:'xianyu',sessionOption:'AutoLoginOnly',spm_cnt:'a21ybx.item.0.0'});
  const r = await new Promise(r2 => {
    const bd = 'data='+encodeURIComponent(ds);
    const req = https.request(url, { method:'POST', headers:{'Cookie':cs,'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(bd)} }, res => {
      let b=''; res.on('data',c=>b+=c);
      res.on('end',()=>{ try { const m2 = b.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s); r2(m2 ? JSON.parse(m2[1]) : JSON.parse(b)); } catch(e) { r2({}); } });
    }); req.write(bd); req.end();
  });
  
  if (!r.ret?.[0]?.startsWith('SUCCESS')) {
    console.log('API失败:', (r.ret?.[0] || '').slice(0, 60));
    process.exit(0);
  }
  
  const data = r.data || {};
  
  console.log('=== data 顶层 keys ===');
  console.log(Object.keys(data).join(', '));
  
  console.log('\n=== itemDO 所有数值字段 ===');
  const item = data.itemDO || {};
  Object.entries(item).forEach(([k, v]) => {
    if (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v) && v.length < 10)) {
      console.log(`  ${k} = ${v}`);
    }
  });
  
  console.log('\n=== b2cItemDO 所有字段 ===');
  const b2c = data.b2cItemDO || {};
  Object.entries(b2c).forEach(([k, v]) => {
    if (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v) && v.length < 10)) {
      console.log(`  ${k} = ${v}`);
    }
  });
  
  // 递归搜索所有对象找 comment/interact 相关字段
  console.log('\n=== 递归搜索 comment/interact 相关字段 ===');
  function search(obj, path = '', depth = 0) {
    if (depth > 6 || !obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const fp = path ? `${path}.${k}` : k;
      const kl = k.toLowerCase();
      if (kl.includes('comment') || kl.includes('interact') || kl.includes('reply') || kl.includes('msg') || kl.includes('chat') || kl.includes('talk') || kl.includes('evaluate') || kl.includes('review')) {
        console.log(`  ${fp} = ${JSON.stringify(v).slice(0, 60)}`);
      }
      if (typeof v === 'object') search(v, fp, depth + 1);
    }
  }
  search(data);
  
  process.exit(0);
}

function httpGet(url) { return new Promise(r => { http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e => { console.error(e); process.exit(1); });
