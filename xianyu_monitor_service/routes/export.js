/**
 * CSV导出路由
 */
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import * as db from '../db.js';

const router = Router();
router.use(authMiddleware);

/**
 * 导出监控数据为CSV
 * 包含: 商品列表Sheet + 历史趋势Sheet + 变更记录Sheet
 */
router.get('/monitor/:id', (req, res) => {
  const items = db.getItemsByMonitor(req.params.id);
  const monitor = db.getMonitorById(req.params.id);
  
  if (!monitor) return res.status(404).json({ error: '监控不存在' });
  
  const lines = [];
  
  // Sheet 1: 商品列表
  lines.push('闲鱼监控导出,' + new Date().toLocaleString('zh-CN'));
  lines.push('监控关键词,' + monitor.keyword);
  lines.push('');
  lines.push('商品ID,标题,价格,浏览量,想要数,收藏数,留言数,评价数,首次发现,最后更新,检查次数');
  
  for (const item of items) {
    const title = `"${(item.title || '').replace(/"/g, '""')}"`;
    lines.push([
      item.item_id, title, item.price || '',
      item.views || 0, item.wants || 0, item.favorites || 0,
      item.comments || 0, item.reviews || 0,
      item.first_seen || '', item.last_seen || '', item.check_count || 1
    ].join(','));
  }
  
  // Sheet 2: 历史趋势
  lines.push('');
  lines.push('=== 历史趋势 ===');
  lines.push('商品ID,标题,时间,价格,浏览量,想要数,收藏数,留言数,评价数');
  
  for (const item of items.slice(0, 30)) {
    const history = db.getItemHistory(item.id);
    for (const h of history) {
      lines.push([
        item.item_id,
        `"${(item.title || '').replace(/"/g, '""').substring(0, 30)}"`,
        h.timestamp || '',
        h.price || '', h.views || 0, h.wants || 0,
        h.favorites || 0, h.comments || 0, h.reviews || 0
      ].join(','));
    }
  }
  
  // Sheet 3: 变更记录
  lines.push('');
  lines.push('=== 变更记录 ===');
  lines.push('时间,类型,商品ID,标题,详情');
  
  const changes = db.getRecentChanges(req.params.id, 200);
  for (const c of changes) {
    lines.push([
      c.timestamp || '', c.type || '', c.item_id || '',
      `"${((c.item_title || '')).replace(/"/g, '""').substring(0, 30)}"`,
      `"${(c.message || '').replace(/"/g, '""')}"`
    ].join(','));
  }
  
  const csv = '\ufeff' + lines.join('\n');
  const filename = encodeURIComponent(`闲鱼监控_${monitor.keyword}_${new Date().toISOString().split('T')[0]}.csv`);
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

export default router;
