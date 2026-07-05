/**
 * 监控配置 + 商品数据路由
 */
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import * as db from '../db.js';
import { runMonitorNow } from '../scheduler.js';

const router = Router();
router.use(authMiddleware);

// ===== 监控配置 CRUD =====

// 列表
router.get('/', (req, res) => {
  const monitors = db.getMonitorsByUser(req.user.id);
  res.json(monitors);
});

// 创建
router.post('/', (req, res) => {
  const { keyword, interval_min, seed_item_id, seller_name } = req.body;
  
  // 关键词模式: 需要keyword
  // 店铺模式: 需要seed_item_id
  if (!keyword && !seed_item_id) {
    return res.status(400).json({ error: '请输入关键词或商品ID' });
  }
  
  const monitor = db.createMonitor(
    req.user.id,
    keyword || '',
    interval_min || 30,
    seed_item_id || '',
    seller_name || ''
  );
  res.json(monitor);
});

// 单个
router.get('/:id', (req, res) => {
  const monitor = db.getMonitorById(req.params.id);
  if (!monitor) return res.status(404).json({ error: '不存在' });
  if (monitor.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权限' });
  }
  res.json(monitor);
});

// 更新
router.put('/:id', (req, res) => {
  const monitor = db.getMonitorById(req.params.id);
  if (!monitor) return res.status(404).json({ error: '不存在' });
  if (monitor.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权限' });
  }
  db.updateMonitor(req.params.id, req.body);
  res.json({ success: true });
});

// 删除
router.delete('/:id', (req, res) => {
  const monitor = db.getMonitorById(req.params.id);
  if (!monitor) return res.status(404).json({ error: '不存在' });
  if (monitor.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权限' });
  }
  db.deleteMonitor(req.params.id);
  res.json({ success: true });
});

// ===== 统计数据 =====

router.get('/:id/stats', (req, res) => {
  const monitor = db.getMonitorById(req.params.id);
  if (!monitor) return res.status(404).json({ error: '不存在' });
  const stats = db.getMonitorStats(req.params.id);
  stats.keyword = monitor.keyword;
  res.json(stats);
});

// ===== 商品列表 =====

router.get('/:id/items', (req, res) => {
  const items = db.getItemsByMonitor(req.params.id);
  res.json(items);
});

// ===== 变更记录 =====

router.get('/:id/changes', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const changes = db.getRecentChanges(req.params.id, limit);
  res.json(changes);
});

// ===== 手动触发检查 =====

router.post('/:id/check', async (req, res) => {
  try {
    const monitor = db.getMonitorById(req.params.id);
    if (!monitor) return res.status(404).json({ error: '不存在' });
    if (monitor.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '无权限' });
    }
    
    // 异步触发，先返回
    res.json({ success: true, message: '检查已触发' });
    
    runMonitorNow(req.params.id).catch(e => {
      console.error(`手动检查 #${req.params.id} 失败:`, e.message);
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
