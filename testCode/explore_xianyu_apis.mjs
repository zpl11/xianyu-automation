// 通过 CDP 连接到闲鱼页面，主动导航并探索 API 接口
import WebSocket from 'ws';

const WS_URL = `ws://localhost:9222/devtools/page/02C774B60B9D4A995F29D00F9EDDD4CD`;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function send(ws, method, params = {}) {
  return new Promise((resolve) => {
    const id = Date.now() + Math.random();
    ws.send(JSON.stringify({ id, method, params }));
    const cb = (data) => {
      const r = JSON.parse(data.toString());
      if (r.id === id) { ws.removeListener('message', cb); resolve(r); }
    };
    ws.on('message', cb);
  });
}

async function navigateAndCollect(ws, url, label, collectTime = 8000) {
  console.log(`\n========== ${label} ==========`);
  console.log(`🌐 导航到: ${url}`);
  
  await send(ws, 'Page.navigate', { url });
  
  // 等待页面加载
  await new Promise(r => setTimeout(r, 5000));
  
  // 收集网络请求
  const apis = {};
  
  const handler = (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.method === 'Network.requestWillBeSent') {
      const req = msg.params.request;
      const url = req.url;
      if ((url.includes('goofish.com') || url.includes('taobao.com') || url.includes('mtop')) &&
          !url.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp|wasm)$/i)) {
        const path = url.split('?')[0];
        const key = `${req.method} ${path}`;
        if (!apis[key]) apis[key] = { method: req.method, path, postData: req.request.postData || '', count: 0 };
        apis[key].count++;
        if (apis[key].count <= 1) {
          console.log(`  ${req.method} ${path}`);
          if (req.request.postData) console.log(`    POST: ${req.request.postData.substring(0, 200)}`);
        }
      }
    }
  };
  
  ws.on('message', handler);
  await new Promise(r => setTimeout(r, collectTime));
  ws.removeListener('message', handler);
  
  return apis;
}

async function main() {
  console.log('🔌 连接到浏览器...');
  const ws = await connect();
  
  // 启用网络和页面域
  await send(ws, 'Network.enable');
  await send(ws, 'Page.enable');
  
  console.log('✅ 已连接!\n');
  
  // 1. 首页
  const homeApis = await navigateAndCollect(ws, 'https://www.goofish.com/', '🏠 首页');
  
  // 2. 搜索页
  const searchApis = await navigateAndCollect(ws, 'https://www.goofish.com/search?q=耳机', '🔍 搜索页');
  
  // 3. 商品详情 - 找一个实际商品
  const detailApis = await navigateAndCollect(ws, 'https://www.goofish.com/item/12542430781', '📦 商品详情');
  
  // 4. 店铺页 - 可以测试自己的店铺
  // 先尝试通用店铺URL格式
  const shopApis = await navigateAndCollect(ws, 'https://www.goofish.com/shop', '🏪 店铺页');
  
  // 汇总所有API
  console.log('\n\n========== 所有API端点汇总 ==========');
  const allApis = { ...homeApis, ...searchApis, ...detailApis, ...shopApis };
  const sorted = Object.entries(allApis).sort((a, b) => {
    const cat = (k) => k[1].path.includes('detail') ? '1' : k[1].path.includes('item') ? '2' : k[1].path.includes('search') ? '3' : k[1].path.includes('shop') ? '4' : k[1].path.includes('mtop') ? '5' : '9';
    return cat(a).localeCompare(cat(b));
  });
  
  for (const [key, val] of sorted) {
    console.log(`\n${key}`);
    if (val.postData) console.log(`  POST: ${val.postData.substring(0, 300)}`);
  }
  
  // 尝试获取一些响应数据
  console.log('\n\n========== 获取关键API的响应 ==========');
  // 重新加载一次，这次抓取响应体
  await send(ws, 'Page.navigate', { url: 'https://www.goofish.com/item/12542430781' });
  await new Promise(r => setTimeout(r, 5000));
  
  const responses = [];
  const respHandler = (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response.url;
      if (url.includes('api') || url.includes('mtop') || url.includes('detail') || url.includes('item')) {
        responses.push({ requestId: msg.params.requestId, url });
      }
    }
  };
  ws.on('message', respHandler);
  await new Promise(r => setTimeout(r, 5000));
  ws.removeListener('message', respHandler);
  
  for (const resp of responses.slice(0, 10)) {
    try {
      const body = await send(ws, 'Network.getResponseBody', { requestId: resp.requestId });
      if (body.result?.body) {
        const b = body.result.body;
        if (b.length > 20 && b.length < 100000) {
          console.log(`\n📥 ${resp.url.split('?')[0].substring(0, 120)}`);
          try {
            const json = JSON.parse(b.replace(/^mtopjsonp\d+\(/, '').replace(/\)$/, ''));
            console.log(`   响应: ${JSON.stringify(json).substring(0, 800)}`);
          } catch(e) {
            console.log(`   响应(text): ${b.substring(0, 300)}`);
          }
        }
      }
    } catch(e) {}
  }
  
  ws.close();
  console.log('\n✅ 分析完成');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ 错误:', err);
  process.exit(1);
});
