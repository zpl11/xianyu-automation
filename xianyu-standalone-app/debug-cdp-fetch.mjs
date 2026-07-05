import http from 'http';
import crypto from 'crypto';
import WebSocket from 'ws';

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

async function evaluateInPage(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    ws.on('message', data => {
      try {
        const resp = JSON.parse(data);
        if (resp.id === 1) {
          ws.close();
          if (resp.result && resp.result.exceptionDetails) {
            reject(new Error(resp.result.exceptionDetails.exception.description || 'Evaluate error'));
          } else {
            resolve(resp.result.result.value);
          }
        }
      } catch (e) {}
    });
    ws.on('error', reject);
  });
}

async function getCookies(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies' }));
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

async function main() {
  const pages = await getCDPPage();
  const page = pages.find(p => p.url && p.url.includes('goofish.com') && !p.url.includes('g.alicdn'));
  if (!page) {
    console.error('未找到闲鱼页面');
    return;
  }
  const wsUrl = page.webSocketDebuggerUrl.replace('ws://localhost:9222', 'http://localhost:9222');
  
  const cookies = await getCookies(wsUrl);
  const tk = cookies.find(c => c.name === '_m_h5_tk');
  if (!tk) {
    console.error('未找到 _m_h5_tk cookie');
    return;
  }
  const token = tk.value.split('_')[0];
  
  const apiName = 'idle.web.xyh.item.list';
  const data = { needGroupInfo: true, pageNumber: 1, userId: '2219548027557', pageSize: 20 };
  const ts = Date.now();
  const dataStr = JSON.stringify(data);
  const sign = crypto.createHash('md5').update(`${token}&${ts}&${APP_KEY}&${dataStr}`).digest('hex');
  const params = { jsv: '2.7.2', appKey: APP_KEY, t: String(ts), sign, v: '1.0', type: 'originaljson', api: `mtop.${apiName}`, dataType: 'json', timeout: '20000', accountSite: 'xianyu', sessionOption: 'AutoLoginOnly', spm_cnt: 'a21ybx.personal.0.0' };
  const url = `https://h5api.m.goofish.com/h5/mtop.${apiName}/1.0/?${new URLSearchParams(params)}`;
  const bd = `data=${encodeURIComponent(dataStr)}`;

  const expression = `
    fetch("${url}", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: "${bd}",
      credentials: "omit" 
    }).then(r => r.text()).catch(e => "FETCH_ERROR:" + e.message)
  `;
  
  // Note: we might need credentials: "include" for cookies, but MTOP uses tokens mainly, wait no, cookies are required for user validation.
  const expressionWithCreds = expression.replace('"omit"', '"include"');
  
  console.log('在浏览器上下文中执行 fetch...');
  const result = await evaluateInPage(wsUrl, expressionWithCreds);
  console.log('结果(前200字符):', typeof result === 'string' ? result.substring(0, 200) : result);
}

main().catch(console.error);
