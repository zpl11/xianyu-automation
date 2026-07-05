/**
 * 商品详情 + 历史趋势路由
 */
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import * as db from '../db.js';

const router = Router();
router.use(authMiddleware);

// 商品详情
router.get('/:id', (req, res) => {
  const item = db.getItemById(req.params.id);
  if (!item) return res.status(404).json({ error: '不存在' });
  res.json(item);
});

// 历史趋势
router.get('/:id/history', (req, res) => {
  const history = db.getItemHistory(req.params.id);
  res.json(history);
});

// 变更记录
router.get('/:id/changes', (req, res) => {
  const changes = db.getItemChanges(req.params.id);
  res.json(changes);
});

export default router;
