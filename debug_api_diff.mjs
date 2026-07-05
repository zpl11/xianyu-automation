/**
 * 对比浏览器实际API请求 vs 我们直接调用的差异
 * 捕获浏览器发出的完整请求头，然后复现
 */
import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import crypto from 'crypto';
import { URLSearchParams } from 'url';

const CDP_PORT = 9222;
const MTOP_BASE = 'https://h5api.m.goofish.com/h5';
const APP_KEY = '34839810';

async function main() {
  // 1. 创建CDP页面
  const pageInfo = await new Promise(r => {
    const req = http.request('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
    }); req.end();
  });
  
  const ws = await new Promise(r => { const w = new WebSocket(pageInfo.webSocketDebuggerUrl); w.on('open', () => r(w)); });
  let cmdId = 1;
  const pending = new Map();
  let browserRequest = null;  // 浏览器发出的请求详情
  let browserResponse = null; // 浏览器收到的响应
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id) {
      const h = pending.get(msg.id);
      if (h) { clearTimeout(h.t); pending.delete(msg.id); h.r(msg); }
    } else if (msg.method === 'Network.requestWillBeSent') {
      const url = msg.params.request?.url || '';
      if (url.includes('xyh.item.list') && !browserRequest) {
        browserRequest = {
          url: url,
          method: msg.params.request.method,
          headers: msg.params.request.headers,
          postData: msg.params.request.postData || '',
        };
        console.log('📥 捕获到浏览器请求!');
      }
    } else if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response?.url || '';
      if (url.includes('xyh.item.list') && !browserResponse) {
        browserResponse = {
          status: msg.params.response.status,
          headers: msg.params.response.headers,
        };
        const rid = msg.params.requestId;
        setTimeout(async () => {
          const id2 = cmdId++;
          ws.send(JSON.stringify({ id: id2, method: 'Network.getResponseBody', params: { requestId: rid } }));
          const result = await new Promise(r => pending.set(id2, { r, t: setTimeout(() => r({result:{}}), 3000) }));
          browserResponse.body = result.result?.body || '';
        }, 100);
      }
    }
  });
  
  const send = (m, p) => new Promise(r => {
    const id = cmdId++;
    const t = setTimeout(() => { pending.delete(id); r({}); }, 15000);
    pending.set(id, { r, t }); ws.send(JSON.stringify({ id, method: m, params: p }));
  });
  
  await send('Network.enable');
  await send('Page.enable');
  
  // 2. 导航到店铺页触发API调用
  const userId = '2217571424592';
  console.log('导航到店铺页...');
  await send('Page.navigate', { url: `https://www.goofish.com/personal?userId=${userId}` });
  await new Promise(r => setTimeout(r, 8000));
  
  // 3. 等待浏览器请求被捕获
  await new Promise(r => setTimeout(r, 2000));
  
  if (!browserRequest) {
    console.log('❌ 未捕获到浏览器请求');
    ws.close();
    return;
  }
  
  console.log('\n' + '=' * 60);
  console.log('浏览器实际请求 (Chrome)');
  console.log('=' * 60);
  console.log('\nURL: ' + browserRequest.url);
  console.log('\n请求头:');
  const reqHeaders = browserRequest.headers || {};
  for (const [k, v] of Object.entries(reqHeaders)) {
    if (k.toLowerCase() === 'cookie') {
      console.log(`  ${k}: ${v.slice(0, 200)}...`);
    } else {
      console.log(`  ${k}: ${v}`);
    }
  }
  console.log('\n请求体: ' + (browserRequest.postData || '(空)'));
  
  // 4. 提取Cookie
  const cookieResult = await send('Network.getAllCookies');
  const allCookies = cookieResult.result?.cookies || [];
  const domainCookies = allCookies.filter(c => 
    c.domain.includes('goofish.com') || c.domain.includes('taobao.com') || c.domain.includes('tb.cn')
  );
  const cookieStr = domainCookies.map(c => `${c.name}=${c.value}`).join('; ');
  
  const tkCookie = allCookies.find(c => c.name === '_m_h5_tk');
  const token = tkCookie ? tkCookie.value.split('_')[0] : '';
  
  console.log('\n' + '=' * 60);
  console.log('用Node.js复现请求');
  console.log('=' + '=' * 60);
  
  // 5. 提取URL参数
  const urlObj = new URL(browserRequest.url);
  const browserParams = Object.fromEntries(urlObj.searchParams.entries());
  console.log('\nURL参数:');
  for (const [k, v] of Object.entries(browserParams)) {
    console.log(`  ${k}: ${v.slice(0, 60)}`);
  }
  
  // 6. 用同样的参数和签名复现
  const apiName = browserParams.api || 'idle.web.xyh.item.list';
  const ts = parseInt(browserParams.t || Date.now());
  const dataStr = browserRequest.postData ? 
    decodeURIComponent(browserRequest.postData.replace('data=', '')) : '{}';
  const data = JSON.parse(dataStr || '{}');
  
  // 浏览器实际的签名
  const browserSign = browserParams.sign || '';
  
  // 我们自己计算的签名
  const ourSignStr = `${token}&${ts}&${APP_KEY}&${dataStr}`;
  const ourSign = crypto.createHash('md5').update(ourSignStr).digest('hex');
  
  console.log('\n签名对比:');
  console.log(`  浏览器签名: ${browserSign}`);
  console.log(`  我们计算的: ${ourSign}`);
  console.log(`  是否一致: ${browserSign === ourSign ? '✅ 一致' : '❌ 不一致'}`);
  
  if (browserSign !== ourSign) {
    console.log('\n签名不一致的可能原因:');
    console.log(`  浏览器token: ${token ? token.slice(0, 15) + '...' : '无'}`);
    console.log(`  时间戳: ${ts}`);
    console.log(`  数据: ${dataStr.slice(0, 100)}`);
    console.log(`  签名原文: ${ourSignStr.slice(0, 100)}...`);
  }
  
  // 7. 用Node.js发送完全相同的请求
  console.log('\n\n用Node.js发送请求...');
  
  const ourParams = new URLSearchParams(browserParams);
  const ourUrl = `https://h5api.m.goofish.com/h5/mtop.${apiName}/1.0/?${ourParams}`;
  
  try {
    const result = await new Promise((resolve, reject) => {
      const req = https.request(ourUrl, {
        method: 'POST',
        headers: {
          'Cookie': cookieStr,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://www.goofish.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.goofish.com/',
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const match = body.match(/^\s*mtopjsonp\d+\s*\((.*)\)\s*;?\s*$/s);
            if (match) {
              resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(match[1]) });
            } else {
              resolve({ status: res.statusCode, headers: res.headers, body: body.slice(0, 500) });
            }
          } catch(e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(browserRequest.postData || 'data=' + encodeURIComponent(dataStr));
      req.end();
    });
    
    console.log(`响应状态: ${result.status}`);
    const body = result.body;
    if (body.ret) {
      console.log(`ret: ${body.ret[0]}`);
    } else {
      console.log(`body: ${JSON.stringify(body).slice(0, 200)}`);
    }
    
  } catch(e) {
    console.log('请求失败: ' + e.message);
  }
  
  ws.close();
  process.exit(0);
}

main().catch(e => { console.error('错误:', e); process.exit(1); });
