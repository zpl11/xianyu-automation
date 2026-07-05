/**
 * 深度扫描 cardData，查找任何可能包含统计数据的地方
 */
import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import crypto from 'crypto';
import { URLSearchParams } from 'url';

const APP_KEY = '34839810';

async function main() {
  // 获取session
  const targets = JSON.parse(await httpGet('http://127.0.0.1:9222/json'));
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
  
  // 获取 xyh.item.list 的第一页商品
  const ts = Date.now();
  const data = { needGroupInfo: true, pageNumber: 1, userId: '2221400994666', pageSize: 20 };
  const dataStr = JSON.stringify(data);
  const sign = crypto.createHash('md5').update(`${token}&${ts}&${APP_KEY}&${dataStr}`).digest('hex');
  const url = `https://h5api.m.goofish.com/h5/mtop.idle.web.xyh.item.list/1.0/?${new URLSearchParams({jsv:'2.7.2',appKey:APP_KEY,t:String(ts),sign,v:'1.0',type:'originaljson',api:'mtop.idle.web.xyh.item.list',dataType:'json',timeout:'20000',accountSite:'xianyu',sessionOption:'AutoLoginOnly',spm_cnt:'a21ybx.personal.0.0'})}`;
  
  const result = await new Promise(r => {
    const req = https.request(url, {method:'POST',headers:{'Cookie':cookieStr,'Content-Type':'application/x-www-form-urlencoded','Origin':'https://www.goofish.com','Referer':'https://www.goofish.com/','User-Agent':'Mozilla/5.0'}}, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { const m = b.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s); r(m ? JSON.parse(m[1]) : { raw: b.slice(0, 200) }); });
    }); req.write(`data=${encodeURIComponent(dataStr)}`); req.end();
  });
  
  // 深度搜索每个cardData，查找所有可能的统计字段
  const cards = result.data?.cardList || [];
  console.log(`共 ${cards.length} 个卡片，深度搜索统计字段...\n`);
  
  const statKeywords = ['want', 'browse', 'view', 'collect', 'favor', 'comment', 'evaluate', 'review', 'star', 'like', 'heat', 'hot', 'popular', 'sale', 'count', 'num', 'cnt'];
  
  function searchKeys(obj, path = '', depth = 0) {
    if (depth > 8 || !obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const fullPath = path ? `${path}.${k}` : k;
      const lower = k.toLowerCase();
      
      // 检查是否是统计相关字段
      if (statKeywords.some(sk => lower.includes(sk))) {
        console.log(`  📊 ${fullPath} = ${JSON.stringify(v).slice(0, 100)}`);
      }
      
      // 也检查数字类型的字段
      if (typeof v === 'number' && v > 0 && !k.startsWith('_') && !k.includes('Timestamp') && !k.includes('Time')) {
        if (k.length < 30) {
          console.log(`  🔢 ${fullPath} = ${v}`);
        }
      }
      
      if (typeof v === 'object' && v !== null) {
        searchKeys(v, fullPath, depth + 1);
      }
    }
  }
  
  // 搜索第一个卡片的完整数据
  if (cards.length > 0) {
    console.log('=== 第1个卡片完整数据结构 ===');
    console.log(JSON.stringify(cards[0], null, 2).slice(0, 5000));
    console.log('\n=== 统计相关字段 ===');
    searchKeys(cards[0]);
  }
  
  process.exit(0);
}

function httpGet(url) { return new Promise(r => { http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => console.error(e));
