// Xianyu Monitor - Background Service Worker
// 负责定时监控、消息中转、数据导出

const MONITOR_INTERVAL_MINUTES = 5; // 监控间隔（分钟）
const MONITOR_KEYWORD = 'zhaopenglong1314'; // 默认监控关键词（用户名或商品关键词）

// ====== 初始化 ======
chrome.runtime.onInstalled.addListener(() => {
    // 创建定时器
    chrome.alarms.create('monitorCheck', {
        periodInMinutes: MONITOR_INTERVAL_MINUTES
    });
    
    // 初始化存储
    chrome.storage.local.get('monitorData', (result) => {
        if (!result.monitorData) {
            chrome.storage.local.set({
                monitorData: { items: {}, storeInfo: {}, lastUpdated: Date.now() },
                settings: {
                    monitorKeyword: MONITOR_KEYWORD,
                    checkInterval: MONITOR_INTERVAL_MINUTES,
                    enableNotifications: true
                }
            });
        }
    });
    
    console.log(`[Xianyu Monitor] 已启动，监控间隔: ${MONITOR_INTERVAL_MINUTES}分钟`);
});

// ====== 定时监控 ======
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'monitorCheck') {
        console.log('[Xianyu Monitor] 执行定时检查...');
        await performMonitoringCheck();
    }
});

// ====== 执行监控检查 ======
async function performMonitoringCheck() {
    try {
        // 获取设置
        const settings = await chrome.storage.local.get('settings');
        const keyword = settings.settings?.monitorKeyword || MONITOR_KEYWORD;
        
        // 找闲鱼标签页
        const tabs = await chrome.tabs.query({ url: '*://*.goofish.com/*' });
        
        if (tabs.length === 0) {
            console.log('[Xianyu Monitor] 没有打开的闲鱼标签页，跳过检查');
            return;
        }
        
        const tab = tabs[0];
        
        // 向 content script 发送信号，让它检查存储的数据
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_STATS' }).catch(() => null);
        
        if (response?.success) {
            console.log('[Xianyu Monitor] 统计数据:', response.stats);
            
            // 检查是否有新商品
            if (response.stats.newToday > 0) {
                await sendNotification('闲鱼监控', `今日上新 ${response.stats.newToday} 个商品`);
            }
        }
        
        // 导航到搜索页以触发 API 调用（捕获最新数据）
        const goofishUrl = `https://www.goofish.com/search?q=${encodeURIComponent(keyword)}`;
        await chrome.tabs.update(tab.id, { url: goofishUrl });
        
        console.log(`[Xianyu Monitor] 已导航到搜索页: ${keyword}`);
        
    } catch (err) {
        console.error('[Xianyu Monitor] 监控检查失败:', err);
    }
}

// ====== 通知 ======
async function sendNotification(title, message) {
    try {
        const settings = await chrome.storage.local.get('settings');
        if (settings.settings?.enableNotifications !== false) {
            await chrome.notifications.create({
                type: 'basic',
                iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEoSURBVDiNpZMxTsNAEEX/rNeOAwUlBVdA4gJcAokLUNDRcAQkLkCBaOkouQIVHZyAgoKSK0QsYskae2c5Aku8UqTRjFb/b3ZnBLDlWZbxGMeRlsslwzBgGAZkWYamaXAcR4gxQggBKSXHcYT3HkIIDMOArutQlgX6vkdVVRBCkOc5yhhjpG3b0rZtAQBKKTLGkBgjpZQkhL6UJCJiSomIyBij9x5KKYgxQggB/X5/3+/3A8BjWZbGGJNzzrn3HkIICCHQNA2MMQjDEEopKKVQFAWstVBKobZtC601pJSQUm632383Syn3WmuKy4n3Hk3TQEqJMAwhhEBVVdhsNhiPx+j7HkEQoKoqOOdQliWstQAAYwy893DOQQiBIAgQhiHCMITWGsYYXJYlgH8A1c2L0/SQ+uEAAAAASUVORK5CYII=',
                title: title || '闲鱼监控',
                message: message || '',
                priority: 2
            });
        }
    } catch(e) {}
}

// ====== 消息处理 ======
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case 'TRIGGER_CHECK':
            performMonitoringCheck().then(() => {
                sendResponse({ success: true });
            }).catch(err => {
                sendResponse({ success: false, error: err.message });
            });
            return true;
            
        case 'ITEM_UPDATED':
            // 可以在这里处理实时通知
            if (request.isNew) {
                sendNotification('闲鱼上新提醒', `新商品上架！`);
            } else if (request.changes) {
                const changeTypes = Object.keys(request.changes);
                if (changeTypes.length > 0) {
                    sendNotification('闲鱼数据变更', `${changeTypes.length} 项数据发生变化`);
                }
            }
            break;
            
        case 'GET_SETTINGS':
            chrome.storage.local.get('settings', (result) => {
                sendResponse({ success: true, settings: result.settings });
            });
            return true;
            
        case 'UPDATE_SETTINGS':
            chrome.storage.local.set({ settings: request.settings }, () => {
                // 更新定时器间隔
                if (request.settings.checkInterval) {
                    chrome.alarms.clear('monitorCheck');
                    chrome.alarms.create('monitorCheck', {
                        periodInMinutes: request.settings.checkInterval
                    });
                }
                sendResponse({ success: true });
            });
            return true;
            
        case 'EXPORT_DATA':
            exportData(request.format || 'csv').then(result => {
                sendResponse(result);
            });
            return true;
    }
});

// ====== 导出数据 ======
async function exportData(format) {
    const result = await chrome.storage.local.get('monitorData');
    const data = result.monitorData;
    if (!data?.items) return { success: false, error: '没有数据' };
    
    const items = Object.values(data.items);
    
    if (format === 'csv') {
        // CSV 格式
        const headers = ['商品ID', '标题', '价格', '浏览量', '想要数', '收藏数', '留言数', '评价数', '首次发现', '最后更新', '检查次数'];
        const rows = items.map(item => [
            item.itemId,
            `"${(item.title || '').replace(/"/g, '""')}"`,
            item.price,
            item.views || 0,
            item.wants || 0,
            item.favorites || 0,
            item.comments || 0,
            item.reviews || 0,
            new Date(item.firstSeen).toLocaleString('zh-CN'),
            new Date(item.lastSeen).toLocaleString('zh-CN'),
            item.checkCount || 1
        ]);
        
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        
        try {
            await chrome.downloads.download({
                url: url,
                filename: `闲鱼监控数据_${new Date().toISOString().split('T')[0]}.csv`,
                saveAs: true
            });
            return { success: true, format: 'csv' };
        } catch(e) {
            return { success: false, error: e.message, csvData: csv };
        }
    }
    
    if (format === 'json') {
        const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        try {
            await chrome.downloads.download({
                url: url,
                filename: `闲鱼监控数据_${new Date().toISOString().split('T')[0]}.json`,
                saveAs: true
            });
            return { success: true, format: 'json' };
        } catch(e) {
            return { success: false, error: e.message };
        }
    }
    
    return { success: false, error: `不支持的格式: ${format}` };
}

console.log('[Xianyu Monitor] Background Service Worker 已加载');
