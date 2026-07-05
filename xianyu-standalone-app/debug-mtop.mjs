import http from 'http';
import https from 'https';
import crypto from 'crypto';

const APP_KEY = '34839810';

async function getCDPPage() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

import WebSocket from 'ws';

async function getCookies(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Network.getCookies', params: { urls: ['https://www.goofish.com'] } }));
    });
    ws.on('message', data => {
      try {
        const resp = JSON.parse(data);
        if (resp.id === 1 && resp.result && resp.result.cookies) {
          resolve(resp.result.cookies);
          ws.close();
        }
      } catch (e) {}
    });
    ws.on('error', reject);
  });
}

async function debugCallMTOP(cookies, userId) {
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const tokenCookie = cookies.find(c => c.name === '_m_h5_tk');
  if (!tokenCookie) {
    console.error('未找到 _m_h5_tk cookie');
    return;
  }
  const token = tokenCookie.value.split('_')[0];
  
  const apiName = 'idle.web.xyh.item.list';
  const data = { needGroupInfo: true, pageNumber: 1, userId: String(userId), pageSize: 20 };
  const ts = Date.now();
  const dataStr = JSON.stringify(data);
  const sign = crypto.createHash('md5').update(`${token}&${ts}&${APP_KEY}&${dataStr}`).digest('hex');
  const params = { jsv: '2.7.2', appKey: APP_KEY, t: String(ts), sign, v: '1.0', type: 'originaljson', api: `mtop.${apiName}`, dataType: 'json', timeout: '20000', accountSite: 'xianyu', sessionOption: 'AutoLoginOnly', spm_cnt: 'a21ybx.personal.0.0' };
  const url = `https://h5api.m.goofish.com/h5/mtop.${apiName}/1.0/?${new URLSearchParams(params)}`;
  
  console.log(`[DEBUG] Requesting MTOP...`);
  const bd = `data=${encodeURIComponent(dataStr)}`;
  
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers: { 'Cookie': cookieStr, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(bd), 'Origin': 'https://www.goofish.com', 'Referer': 'https://www.goofish.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' }}, res => {
      console.log(`[DEBUG] Response Status: ${res.statusCode}`);
      let body = '';
      let receivedBytes = 0;
      res.on('data', c => {
        receivedBytes += c.length;
        body += c;
        console.log(`[DEBUG] Received chunk, total bytes: ${receivedBytes}`);
      });
      res.on('end', () => { 
        console.log(`[DEBUG] Response End`);
        try { 
          const m = body.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s); 
          resolve(m ? JSON.parse(m[1]) : JSON.parse(body)); 
        } catch(e) { 
          console.error(`[DEBUG] Parse Error:`, e);
          resolve(body);
        } 
      });
      res.on('error', e => console.error(`[DEBUG] Response Error:`, e));
      res.on('aborted', () => console.error(`[DEBUG] Response Aborted`));
    }); 
    req.setTimeout(15000, () => {
      console.error(`[DEBUG] Request Timeout`);
      req.destroy();
    });
    req.on('error', e => console.error(`[DEBUG] Request Error:`, e));
    req.write(bd); 
    req.end();
  });
}

async function main() {
  console.log('获取 Chrome 页面列表...');
  const pages = await getCDPPage();
  const page = pages.find(p => p.url && p.url.includes('goofish.com'));
  if (!page) {
    console.error('未找到闲鱼页面');
    return;
  }
  console.log(`找到闲鱼页面: ${page.title}`);
  
  const wsUrl = page.webSocketDebuggerUrl.replace('ws://localhost:9222', 'http://localhost:9222');
  console.log(`获取 Cookies...`);
  const cookies = await getCookies(wsUrl);
  console.log(`获取到 ${cookies.length} 个 Cookies`);
  
  const userId = '2219548027557'; // 康钱网络游戏室_闲鱼
  console.log(`发起 MTOP 请求获取店铺数据 (userId: ${userId})...`);
  const result = await debugCallMTOP(cookies, userId);
  
  if (result && result.data && result.data.cardList) {
    console.log(`成功获取商品，共 ${result.data.totalCount} 个`);
  } else {
    console.log(`MTOP 请求返回:`, JSON.stringify(result, null, 2));
  }
}

main().catch(console.error);
