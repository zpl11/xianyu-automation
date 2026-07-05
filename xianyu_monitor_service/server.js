/**
 * 闲鱼监控 SaaS 平台 - 入口
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { initDB, createUser } from './db.js';
import { hashPassword } from './auth.js';
import { startScheduler } from './scheduler.js';
import { checkLogin, loadSession, saveSession } from './scraper.js';

import authRoutes from './routes/auth.js';
import monitorRoutes from './routes/monitors.js';
import itemRoutes from './routes/items.js';
import exportRoutes from './routes/export.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/monitors', monitorRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/export', exportRoutes);

// Cookie 设置接口（管理员首次配置）
app.post('/api/setup/cookie', express.json(), (req, res) => {
  try {
    const { cookie } = req.body;
    if (!cookie) return res.status(400).json({ error: '请提供Cookie' });
    saveSession(cookie);
    res.json({ success: true, message: 'Cookie已保存' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Cookie 状态检查
app.get('/api/setup/status', (req, res) => {
  const session = loadSession();
  res.json({ hasCookie: !!session, cookieAge: session ? Math.floor((Date.now() - session.savedAt) / 1000) : 0 });
});

// 前端SPA支持 - 所有非API路由返回index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动
async function main() {
  console.log('');
  console.log('='.repeat(50));
  console.log('  闲鱼监控 SaaS 平台');
  console.log('='.repeat(50));
  console.log('');
  
  // 初始化数据库
  initDB();
  
  // 创建默认管理员
  const admin = createUser(
    process.env.ADMIN_USERNAME || 'admin',
    hashPassword(process.env.ADMIN_PASSWORD || 'admin123'),
    'admin'
  );
  if (admin) {
    console.log(`[Init] 管理员已创建: ${admin.username}`);
  } else {
    console.log('[Init] 管理员已存在');
  }
  
  // 启动服务器
  app.listen(PORT, () => {
    console.log(`[Server] 🌐 http://localhost:${PORT}`);
    console.log(`[Server] 管理员账号: ${process.env.ADMIN_USERNAME || 'admin'} / ${process.env.ADMIN_PASSWORD || 'admin123'}`);
    console.log('');
  });
  
  // 检查Cookie登录状态
  const session = loadSession();
  if (session) {
    console.log('[Init] ✅ 已找到保存的Cookie');
    const loggedIn = await checkLogin();
    if (loggedIn) {
      console.log('[Init] ✅ Cookie有效，闲鱼API已就绪');
      startScheduler();
    } else {
      console.log('[Init] ⚠️ Cookie已过期，请重新设置');
      console.log('[Init]    打开 http://localhost:' + PORT + '/setup-cookie.html');
    }
  } else {
    console.log('[Init] ⚠️ 未配置Cookie');
    console.log('[Init]    打开 http://localhost:' + PORT + '/setup-cookie.html');
    console.log('[Init]    或运行: node setup_cookie.mjs');
  }
}

main().catch(e => {
  console.error('[Fatal]', e);
  process.exit(1);
});

// 退出清理
process.on('SIGINT', async () => {
  console.log('\n[Server] 正在关闭...');
  await closeBrowser();
  process.exit(0);
});
