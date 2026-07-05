// Xianyu Monitor - Content Script
// 负责接收 inject.js 拦截的数据，处理后存储到 chrome.storage

// ====== 初始化 ======
function injectScript() {
    const script = document.createElement('script');
    script.setAttribute('type', 'text/javascript');
    script.setAttribute('src', chrome.runtime.getURL('inject.js'));
    (document.head || document.documentElement).appendChild(script);
}
injectScript();

// ====== 数据解析器 ======
const Parser = {
    // 解析 MTOP JSONP 响应
    parseMTOP(text) {
        if (!text) return null;
        let jsonStr = text;
        if (text.startsWith('mtopjsonp')) {
            const start = text.indexOf('(') + 1;
            const end = text.lastIndexOf(')');
            if (start > 0 && end > start) {
                jsonStr = text.substring(start, end);
            }
        }
        try {
            return JSON.parse(jsonStr);
        } catch(e) {
            return null;
        }
    },

    // 从搜索API提取商品列表
    extractSearchItems(json) {
        if (!json?.data) return [];
        
        // 尝试多种可能的数据路径
        const data = json.data;
        let items = data.items || data.resultInfo?.items || data.searchItems || [];
        
        if (!Array.isArray(items) && data.itemList) items = data.itemList;
        if (!Array.isArray(items) && data.item) items = [data.item];
        
        return items.map(item => {
            const i = item.item || item;
            return {
                itemId: i.itemId || i.id || i.item_id || '',
                title: (i.title || '').trim(),
                price: i.price || i.reservePrice || '',
                views: parseInt(i.viewCount || i.views || i.viewNum || i.pageViewCount || 0, 10),
                wants: parseInt(i.favorNum || i.wantCount || i.wantNum || i.favorCount || 0, 10),
                favorites: parseInt(i.collectNum || i.favoriteNum || i.starNum || i.collectCount || 0, 10),
                comments: parseInt(i.commentNum || i.replyNum || i.chatNum || i.CommentCount || 0, 10),
                reviews: parseInt(i.reviewNum || i.evaluateNum || i.rateNum || 0, 10),
                imageUrl: i.image || i.picUrl || i.pic || '',
                pubTime: i.pubTime || i.publishTime || i.createTime || i.gmtCreate || '',
                location: i.location || i.city || i.province || '',
                url: `https://www.goofish.com/item?id=${i.itemId || i.id || i.item_id || ''}`,
                sellerId: i.sellerId || i.userId || i.seller_id || '',
                sellerName: i.nickname || i.sellerNick || i.userName || i.nick || '',
                status: i.soldOut ? '已卖出' : (i.status === 'sold' || i.status === '2' ? '已卖出' : '在售')
            };
        }).filter(item => item.itemId);
    },

    // 从商品详情API提取数据
    extractItemDetail(json) {
        if (!json?.data) return null;
        const data = json.data;
        const item = data.item || data.detail || data;
        
        if (!item || !item.itemId) return null;
        
        return {
            itemId: item.itemId || item.id || '',
            title: (item.title || '').trim(),
            price: item.price || item.reservePrice || '',
            views: parseInt(item.viewCount || item.views || item.viewNum || item.pageViewCount || 0, 10),
            wants: parseInt(item.favorNum || item.wantCount || item.wantNum || item.favorCount || 0, 10),
            favorites: parseInt(item.collectNum || item.favoriteNum || item.starNum || item.collectCount || 0, 10),
            comments: parseInt(item.commentNum || item.replyNum || item.chatNum || 0, 10),
            reviews: parseInt(item.reviewNum || item.evaluateNum || item.rateNum || 0, 10),
            description: (item.desc || item.description || '').substring(0, 500),
            imageUrl: item.image || item.picUrl || item.pic || '',
            pubTime: item.pubTime || item.publishTime || item.createTime || '',
            location: item.location || item.city || '',
            sellerId: item.sellerId || item.userId || '',
            sellerName: item.nickname || item.sellerNick || '',
            categoryName: item.categoryName || item.cateName || ''
        };
    },

    // 从DOM抓取数据中提取
    extractDOMItem(data) {
        if (!data) return null;
        return {
            itemId: data.url?.match(/id[=](\d+)/)?.[1] || data.url?.match(/item\/(\d+)/)?.[1] || '',
            title: data.title || '',
            price: data.price || '',
            wants: parseInt(data.wantCount || 0, 10),
            views: 0,
            favorites: 0,
            comments: 0,
            reviews: 0,
            url: data.url || '',
            timestamp: data.timestamp || Date.now()
        };
    }
};

// ====== 存储管理器 ======
const Storage = {
    // 获取所有监控数据
    async getAll() {
        const result = await chrome.storage.local.get('monitorData');
        return result.monitorData || { items: {}, storeInfo: {}, lastUpdated: Date.now() };
    },

    // 保存完整数据
    async saveAll(data) {
        await chrome.storage.local.set({ monitorData: data });
    },

    // 更新或添加商品
    async upsertItem(itemData) {
        const data = await this.getAll();
        const id = itemData.itemId;
        if (!id) return;
        
        const now = Date.now();
        const existing = data.items[id];
        
        if (existing) {
            // 检测变化
            const changes = {};
            if (existing.title !== itemData.title) changes.title = { from: existing.title, to: itemData.title };
            if (existing.price !== itemData.price) changes.price = { from: existing.price, to: itemData.price };
            if (existing.views !== itemData.views) changes.views = { from: existing.views, to: itemData.views };
            if (existing.wants !== itemData.wants) changes.wants = { from: existing.wants, to: itemData.wants };
            if (existing.favorites !== itemData.favorites) changes.favorites = { from: existing.favorites, to: itemData.favorites };
            if (existing.comments !== itemData.comments) changes.comments = { from: existing.comments, to: itemData.comments };
            if (existing.reviews !== itemData.reviews) changes.reviews = { from: existing.reviews, to: itemData.reviews };
            
            // 构建历史记录
            const history = existing.history || [];
            history.push({
                timestamp: now,
                title: itemData.title,
                price: itemData.price,
                views: itemData.views,
                wants: itemData.wants,
                favorites: itemData.favorites,
                comments: itemData.comments,
                reviews: itemData.reviews
            });
            if (history.length > 100) history.splice(0, history.length - 100);
            
            // 合并更新数据 (修复bug: 之前误用了旧引用覆盖新数据)
            data.items[id] = {
                ...existing,
                ...itemData,
                firstSeen: existing.firstSeen,
                lastSeen: now,
                checkCount: (existing.checkCount || 1) + 1,
                changes: existing.changes || [],
                history: history
            };
        } else {
            // 新商品
            data.items[id] = {
                ...itemData,
                firstSeen: now,
                lastSeen: now,
                checkCount: 1,
                changes: [{
                    timestamp: now,
                    type: 'NEW',
                    message: '新商品上架'
                }],
                history: [{
                    timestamp: now,
                    title: itemData.title,
                    price: itemData.price,
                    views: itemData.views,
                    wants: itemData.wants,
                    favorites: itemData.favorites,
                    comments: itemData.comments,
                    reviews: itemData.reviews
                }]
            };
        }
        
        data.lastUpdated = now;
        await this.saveAll(data);
        
        // 通知background有更新
        chrome.runtime.sendMessage({ 
            type: 'ITEM_UPDATED', 
            itemId: id,
            isNew: !existing,
            changes: Object.keys(changes).length > 0 ? changes : null
        }).catch(() => {});
        
        return { isNew: !existing, changes };
    },

    // 批量更新商品
    async batchUpsert(items) {
        const results = [];
        for (const item of items) {
            const result = await this.upsertItem(item);
            results.push(result);
        }
        // 触发存储更新通知
        await chrome.storage.local.set({ lastBatchUpdate: Date.now() });
        return results;
    },

    // 获取变更历史
    async getChanges(since = 0) {
        const data = await this.getAll();
        const changes = [];
        for (const [id, item] of Object.entries(data.items)) {
            if (item.firstSeen > since) {
                changes.push({ type: 'NEW', itemId: id, title: item.title, timestamp: item.firstSeen });
            }
            if (item.changes) {
                for (const c of item.changes) {
                    if (c.timestamp > since) {
                        changes.push({ ...c, itemId: id, title: item.title });
                    }
                }
            }
        }
        return changes.sort((a, b) => b.timestamp - a.timestamp);
    },

    // 获取统计数据
    async getStats() {
        const data = await this.getAll();
        const items = Object.values(data.items);
        const now = Date.now();
        const day24h = 86400000;
        const day7 = 7 * day24h;
        
        const totalItems = items.length;
        const activeItems = items.filter(i => (now - i.lastSeen) < day24h).length;
        const newToday = items.filter(i => (now - i.firstSeen) < day24h).length;
        const newThisWeek = items.filter(i => (now - i.firstSeen) < day7).length;
        const itemsWithTitleChanges = items.filter(i => i.changes?.some(c => c.type === 'TITLE_CHANGE')).length;
        const totalViews = items.reduce((s, i) => s + (i.views || 0), 0);
        const totalWants = items.reduce((s, i) => s + (i.wants || 0), 0);
        
        return {
            totalItems,
            activeItems,
            newToday,
            newThisWeek,
            itemsWithTitleChanges,
            totalViews,
            totalWants,
            lastUpdated: data.lastUpdated
        };
    }
};

// ====== 消息处理：接收 inject.js 的数据 ======
window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    
    // 处理 fetch/XHR 拦截的数据
    if (msg.type === "XIANYU_INTERCEPT_FETCH" || msg.type === "XIANYU_INTERCEPT_XHR") {
        const url = msg.url;
        const responseText = msg.data;
        const json = Parser.parseMTOP(responseText);
        
        if (!json) return;
        
        // 搜索API → 提取商品列表
        if (json.api?.includes('pc.search') || json.api?.includes('search') || 
            (json.data && (json.data.items || json.data.resultInfo?.items))) {
            const items = Parser.extractSearchItems(json);
            if (items.length > 0) {
                console.log(`[Xianyu Monitor] 搜索API拦截: ${items.length} 个商品`);
                await Storage.batchUpsert(items);
            }
        }
        
        // 商品详情API
        if (json.api?.includes('item.detail') || json.api?.includes('detail') ||
            (json.data?.item?.itemId)) {
            const detail = Parser.extractItemDetail(json);
            if (detail) {
                console.log(`[Xianyu Monitor] 商品详情: ${detail.title?.substring(0, 20)}`);
                await Storage.upsertItem(detail);
            }
        }
        
        // 用户已发布商品列表
        if (json.api?.includes('user.items') || json.api?.includes('publish.list') || 
            json.api?.includes('sell.list') || json.api?.includes('my.items')) {
            const items = Parser.extractSearchItems(json);
            if (items.length > 0) {
                console.log(`[Xianyu Monitor] 用户商品列表: ${items.length} 个`);
                await Storage.batchUpsert(items);
            }
        }
        
        // 通用尝试：如果有 items 数组且包含 itemId，则可能是商品数据
        if (json.data && Array.isArray(json.data.items)) {
            const items = Parser.extractSearchItems(json);
            if (items.length > 0 && !json.api?.includes('suggest')) {
                console.log(`[Xianyu Monitor] 通用API拦截: ${items.length} 个商品`);
                await Storage.batchUpsert(items);
            }
        }
    }
    
    // 处理 DOM 抓取数据
    if (msg.type === "XIANYU_DOM_SCRAPE") {
        const item = Parser.extractDOMItem(msg.data);
        if (item && item.itemId) {
            // DOM数据作为补充，不覆盖API数据
            const data = await Storage.getAll();
            if (!data.items[item.itemId]) {
                await Storage.upsertItem(item);
            } else {
                // 只更新想要数（DOM可能更准确）
                const existing = data.items[item.itemId];
                if (item.wants > 0 && item.wants !== existing.wants) {
                    existing.wants = item.wants;
                    existing.lastSeen = Date.now();
                    await Storage.saveAll(data);
                }
            }
        }
    }
}, false);

// ====== 监听来自 popup/background 的消息 ======
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case "PING":
            sendResponse({ success: true, url: location.href });
            return true;
            
        case "GET_STORAGE_DATA":
            Storage.getAll().then(data => {
                sendResponse({ success: true, data });
            });
            return true;
            
        case "GET_STATS":
            Storage.getStats().then(stats => {
                sendResponse({ success: true, stats });
            });
            return true;
            
        case "GET_CHANGES":
            Storage.getChanges(request.since || 0).then(changes => {
                sendResponse({ success: true, changes });
            });
            return true;
            
        case "SCRAPE_CURRENT_PAGE":
            // 从当前DOM抓取商品
            const products = scrapeCurrentPage();
            sendResponse({ success: true, products });
            return true;
            
        case "CLEAR_DATA":
            chrome.storage.local.remove('monitorData').then(() => {
                sendResponse({ success: true });
            });
            return true;
    }
});

// ====== DOM抓取（兼容旧功能） ======
function scrapeCurrentPage() {
    let products = [];
    const allLinks = document.querySelectorAll('a[href*="item"]');
    
    allLinks.forEach(el => {
        const text = el.innerText || "";
        const wantMatch = text.match(/(\d+)\s*人想要/);
        if (!wantMatch) return;
        
        let price = "0";
        const priceMatch = text.match(/[¥￥]\s*(\d+(\.\d+)?)/);
        if (priceMatch) price = priceMatch[1];
        
        let title = '';
        const titleEl = el.querySelector('[class*="title"], [class*="Title"]');
        if (titleEl) title = titleEl.textContent?.trim() || '';
        if (!title) title = el.getAttribute('title') || '';
        if (!title) {
            const img = el.querySelector('img');
            if (img) title = img.getAttribute('alt') || '';
        }
        
        const href = el.href || '';
        const itemId = href.match(/id[=](\d+)/)?.[1] || '';
        
        if (title && title.length > 3) {
            products.push({
                itemId,
                title: title.replace(/\n/g, ' ').substring(0, 100),
                price,
                wants: parseInt(wantMatch[1], 10),
                url: href
            });
        }
    });
    
    // 去重
    const seen = new Set();
    return products.filter(p => {
        if (seen.has(p.itemId || p.title.substring(0, 20))) return false;
        seen.add(p.itemId || p.title.substring(0, 20));
        return true;
    });
}
