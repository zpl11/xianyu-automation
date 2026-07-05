/**
 * 定时任务调度器
 * 定期执行所有活跃监控的爬虫任务
 */
import cron from 'node-cron';
import { getAllActiveMonitors, upsertItem, getMonitorById } from './db.js';
import { searchAndScrape, scrapeStoreItems } from './scraper.js';

let isRunning = false;

/**
 * 启动调度器
 */
export function startScheduler() {
  console.log('[Scheduler] 启动定时任务...');
  
  // 每5分钟检查一次所有监控
  cron.schedule('*/5 * * * *', async () => {
    if (isRunning) {
      console.log('[Scheduler] 上一轮还在运行，跳过');
      return;
    }
    
    isRunning = true;
    try {
      await runAllMonitors();
    } catch (e) {
      console.error('[Scheduler] 执行失败:', e.message);
    }
    isRunning = false;
  });
  
  // 启动后立即执行一次
  setTimeout(() => runAllMonitors(), 5000);
}

/**
 * 执行所有活跃监控
 */
async function runAllMonitors() {
  const monitors = getAllActiveMonitors();
  console.log(`[Scheduler] 开始执行 ${monitors.length} 个监控任务`);
  
  for (const monitor of monitors) {
    try {
      await runSingleMonitor(monitor);
    } catch (e) {
      console.error(`[Scheduler] 监控 #${monitor.id} "${monitor.keyword}" 失败:`, e.message);
    }
  }
  
  console.log('[Scheduler] 本轮监控完成');
}

/**
 * 执行单个监控
 */
async function runSingleMonitor(monitor) {
  // 店铺模式
  if (monitor.seed_item_id) {
    console.log(`[Scheduler] 店铺监控 #${monitor.id}: "${monitor.seller_name || monitor.seed_item_id}"`);
    
    const result = await scrapeStoreItems(monitor.seed_item_id);
    if (!result.seller) {
      console.log(`[Scheduler] 店铺监控失败`);
      return;
    }
    
    // 保存卖家名
    if (result.seller.nick && result.seller.nick !== monitor.seller_name) {
      const { updateMonitor } = await import('./db.js');
      updateMonitor(monitor.id, { seller_name: result.seller.nick });
    }
    
    // 入库
    let newCount = 0, changeCount = 0;
    for (const item of result.items) {
      const r = upsertItem(monitor.id, item);
      if (r.isNew) newCount++;
      changeCount += r.changes.length;
    }
    
    console.log(`[Scheduler] 店铺监控完成: ${result.items.length}商品, +${newCount}新, ${changeCount}变更`);
    if (result.newIds.length > 0) console.log(`[Scheduler] 🆕 上新: ${result.newIds.join(', ')}`);
    return;
  }
  
  // 关键词模式（原有）
  console.log(`[Scheduler] 关键词监控 #${monitor.id}: "${monitor.keyword}"`);
  
  const items = await searchAndScrape(monitor.keyword);
  if (items.length === 0) {
    console.log(`[Scheduler] "${monitor.keyword}" 未获取到数据`);
    return;
  }
  
  let newCount = 0, changeCount = 0;
  for (const item of items) {
    const result = upsertItem(monitor.id, item);
    if (result.isNew) newCount++;
    changeCount += result.changes.length;
  }
  
  console.log(`[Scheduler] "${monitor.keyword}" 完成: ${items.length}商品, +${newCount}新, ${changeCount}变更`);
}

/**
 * 立即执行指定监控
 */
export async function runMonitorNow(monitorId) {
  const monitor = getMonitorById(monitorId);
  if (!monitor) throw new Error('监控不存在');
  
  await runSingleMonitor(monitor);
  return monitor;
}
