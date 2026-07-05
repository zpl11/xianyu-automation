/**
 * 尝试调用闲鱼移动端 API (api.m.goofish.com)
 * 移动端 API 可能包含 Web 版没有的字段（如留言数）
 */
import http from 'http'; import https from 'https'; import WebSocket from 'ws'; import crypto from 'crypto'; import { URLSearchParams } from 'url';

const APP_KEY = '34839810'; const CDP_PORT = 9222; const ITEM_ID = '1054944275429';

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

  // 测试不同 API 端点
  const endpoints = [
    // Web 版 (已知)
    { base: 'https://h5api.m.goofish.com/h5', name: 'h5api Web版', data: { itemId: ITEM_ID } },
    // 移动版 API (推测)
    { base: 'https://api.m.goofish.com/h5', name: 'api.m 移动版', data: { itemId: ITEM_ID } },
    { base: 'https://api.m.goofish.com/rest', name: 'api.m rest', data: { itemId: ITEM_ID } },
    // 不同参数名
    { base: 'https://h5api.m.goofish.com/h5', name: 'h5api id参数', data: { id: ITEM_ID } },
    { base: 'https://api.m.goofish.com/h5', name: 'api.m id参数', data: { id: ITEM_ID } },
  ];

  for (const ep of endpoints) {
    try {
      const ts = Date.now();
      const ds = JSON.stringify(ep.data);
      const sign = crypto.createHash('md5').update(token+'&'+ts+'&'+APP_KEY+'&'+ds).digest('hex');
      const apiName = 'mtop.taobao.idle.pc.detail';
      const url = `${ep.base}/${apiName}/1.0/?${new URLSearchParams({jsv:'2.7.2',appKey:APP_KEY,t:String(ts),sign,v:'1.0',type:'originaljson',api:apiName,dataType:'json',timeout:'20000',accountSite:'xianyu',sessionOption:'AutoLoginOnly',spm_cnt:'a21ybx.item.0.0'})}`;
      
      const r = await new Promise(r2 => {
        const bd = 'data='+encodeURIComponent(ds);
        const req = https.request(url, { method:'POST', headers:{'Cookie':cs,'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(bd)} }, res => {
          let b=''; res.on('data',c=>b+=c);
          res.on('end',()=>{ try { const m2 = b.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s); r2(m2 ? JSON.parse(m2[1]) : JSON.parse(b)); } catch(e) { r2({ret:['PARSE_ERROR']}); } });
        }); req.write(bd); req.end();
      });
      
      const ret = (r.ret?.[0] || '').slice(0, 50);
      if (ret.startsWith('SUCCESS')) {
        const item = r.data?.itemDO || r.data?.item || {};
        const commentRelated = Object.keys(item).filter(k => /comment|interact|reply|chat|msg|talk/i.test(k));
        console.log(`[${ep.name.padEnd(16)}] ✅ ${ret} | itemId=${item.itemId} | 留言字段:`, commentRelated.map(k => `${k}=${item[k]}`).join(', ') || '无');
      } else if (ret.includes('NOT_FOUNDED')) {
        console.log(`[${ep.name.padEnd(16)}] ❌ API不存在`);
      } else {
        console.log(`[${ep.name.padEnd(16)}] ⚠️ ${ret}`);
      }
    } catch(e) {
      console.log(`[${ep.name.padEnd(16)}] 💥 ${e.message.slice(0, 40)}`);
    }
    await sleep(200);
  }
  process.exit(0);
}

function httpGet(url) { return new Promise(r => { http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e => { console.error(e); process.exit(1); });
