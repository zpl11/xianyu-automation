/**
 * 大规模探测闲鱼API，寻找留言/评价数据
 */
import http from 'http'; import https from 'https'; import WebSocket from 'ws'; import crypto from 'crypto'; import { URLSearchParams } from 'url';
const APP_KEY = '34839810'; const CDP_PORT = 9222; const ITEM = '1008750028209';

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
  const cs = all.filter(c=>['.goofish.com','.taobao.com','.tb.cn','h5api.m.goofish.com'].some(d=>c.domain.includes(d))).map(c=>c.name+'='+c.value).join('; ');
  const token = (all.find(c=>c.name==='_m_h5_tk')?.value||'').split('_')[0];
  console.log(`Token: ${token.slice(0,8)}...\n`);

  // 所有可能的API名称组合
  const prefixes = ['taobao.idle', 'idle'];
  const versions = ['1.0', '2.0'];
  const names = [
    'detail', 'item.detail', 'pc.detail', 'item.get', 'item.info',
    'item.comment.list', 'item.comment.count', 'item.comment',
    'item.interact.count', 'item.interact', 'item.evaluate',
    'item.evaluate.list', 'item.stat', 'item.interact',
    'item.aggregation', 'item.full',
    'comment.list', 'comment.count',
    'interact.count', 'msg.count',
    'evaluate.list', 'evaluate.count',
    'item.consult', 'item.chat',
    'item.activity', 'item.promotion',
  ];

  let found = 0;
  for (const prefix of prefixes) {
    for (const name of names) {
      for (const ver of versions) {
        const api = `mtop.${prefix}.${name}`;
        const data = name.includes('comment') || name.includes('evaluate') || name.includes('interact') 
          ? { itemId: ITEM, pageNumber: 1, pageSize: 5 }
          : { itemId: ITEM };
        
        try {
          const ts = Date.now(); const ds = JSON.stringify(data);
          const sign = crypto.createHash('md5').update(token+'&'+ts+'&'+APP_KEY+'&'+ds).digest('hex');
          const url = `https://h5api.m.goofish.com/h5/${api}/${ver}/?${new URLSearchParams({jsv:'2.7.2',appKey:APP_KEY,t:String(ts),sign,v:ver,type:'originaljson',api:api,dataType:'json',timeout:'5000',accountSite:'xianyu',sessionOption:'AutoLoginOnly'})}`;
          const r = await new Promise(r2 => {
            const bd='data='+encodeURIComponent(ds); const req=https.request(url,{method:'POST',headers:{'Cookie':cs,'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(bd)},timeout:5000},res=>{
              let b='';res.on('data',c=>b+=c);res.on('end',()=>{try{const m2=b.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);r2(m2?JSON.parse(m2[1]):JSON.parse(b))}catch(e){r2({})}});
            });req.write(bd);req.end();
          });
          const ret = (r.ret?.[0] || '');
          if (ret.startsWith('SUCCESS')) {
            found++;
            const d = r.data || {};
            const keys = Object.keys(d);
            // 找数值字段
            const nums = [];
            function findNum(obj, path='') {
              if(!obj||typeof obj!=='object')return;
              for(const[k,v]of Object.entries(obj)){
                const fp=path?path+'.'+k:k;
                if(typeof v==='number'&&v>0) nums.push(fp+'='+v);
                if(typeof v==='object') findNum(v,fp);
              }
            }
            findNum(d);
            console.log(`✅ ${api} v${ver} | keys: ${keys.slice(0,8).join(',')} | nums: ${nums.join(',')||'none'}`);
          } else if (!ret.includes('NOT_FOUNDED') && !ret.includes('PARAM_ERROR')) {
            console.log(`   ${api} v${ver}: ${ret.slice(0,50)}`);
          }
        } catch(e) {}
        await sleep(50);
      }
    }
  }
  console.log(`\n共找到 ${found} 个成功API`);
  process.exit(0);
}

function httpGet(url) { return new Promise(r => { http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e => { console.error(e); process.exit(1); });
