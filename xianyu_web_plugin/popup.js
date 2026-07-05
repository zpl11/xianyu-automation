// Xianyu Monitor - Popup 监控面板

document.addEventListener('DOMContentLoaded', () => {
    // ====== 状态管理 ======
    let monitorData = { items: {}, storeInfo: {} };
    let currentSort = 'lastSeen-desc';
    let currentFilter = '';
    
    // ====== DOM 引用 ======
    const $ = id => document.getElementById(id);
    const statusText = $('status-text');
    const lastUpdate = $('last-update');
    
    // ====== 工具函数 ======
    function formatTime(ts) {
        if (!ts) return '-';
        const d = new Date(ts);
        const now = new Date();
        const diff = now - d;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff/60000)}分钟前`;
        if (diff < 86400000) return `${Math.floor(diff/3600000)}小时前`;
        return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    
    function formatNumber(n) {
        if (!n) return '0';
        if (n > 10000) return (n/10000).toFixed(1) + '万';
        return n.toString();
    }
    
    // ====== 数据加载 ======
    async function loadData() {
        try {
            statusText.textContent = '⏳ 加载数据...';
            
            // 先从 content script 获取
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tab = tabs[0];
            
            if (tab && tab.url?.includes('goofish.com')) {
                const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_STORAGE_DATA' }).catch(() => null);
                if (response?.success && response.data) {
                    monitorData = response.data;
                }
            }
            
            // 如果 content script 没有数据，直接从 storage 读取
            if (Object.keys(monitorData.items).length === 0) {
                const storage = await chrome.storage.local.get('monitorData');
                if (storage.monitorData) {
                    monitorData = storage.monitorData;
                }
            }
            
            updateDashboard();
            statusText.textContent = '✅ 已更新';
            lastUpdate.textContent = `最后更新: ${formatTime(monitorData.lastUpdated)}`;
            
        } catch (err) {
            statusText.textContent = '❌ 加载失败: ' + err.message;
            console.error(err);
        }
    }
    
    // ====== 更新面板 ======
    function updateDashboard() {
        const items = Object.values(monitorData.items);
        const now = Date.now();
        const day24h = 86400000;
        
        // 统计卡片
        $('stat-total').textContent = items.length;
        $('stat-new-today').textContent = items.filter(i => (now - i.firstSeen) < day24h).length;
        $('stat-views').textContent = formatNumber(items.reduce((s, i) => s + (i.views || 0), 0));
        $('stat-wants').textContent = formatNumber(items.reduce((s, i) => s + (i.wants || 0), 0));
        
        // 渲染商品列表
        renderItemTable(items);
        
        // 渲染变更记录
        renderChanges(items);
        
        // 渲染导出预览
        renderExportPreview(items);
    }
    
    // ====== 渲染商品列表 ======
    function renderItemTable(items) {
        const tbody = $('item-table-body');
        
        // 过滤搜索
        let filtered = items;
        if (currentFilter) {
            const kw = currentFilter.toLowerCase();
            filtered = items.filter(i => (i.title || '').toLowerCase().includes(kw) || (i.itemId || '').includes(kw));
        }
        
        // 排序
        const [sortField, sortDir] = currentSort.split('-');
        filtered.sort((a, b) => {
            let va = a[sortField] || (sortField === 'title' ? (a.title || '') : 0);
            let vb = b[sortField] || (sortField === 'title' ? (b.title || '') : 0);
            if (sortField === 'title') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            return sortDir === 'desc' ? vb - va : va - vb;
        });
        
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-row">暂无商品数据</td></tr>';
            return;
        }
        
        tbody.innerHTML = filtered.map(item => {
            const isNew = (Date.now() - item.firstSeen) < 86400000;
            const titleShort = (item.title || '未命名').substring(0, 30);
            return `<tr class="item-row" data-id="${item.itemId}">
                <td class="title-cell">
                    <div class="item-title">${isNew ? '<span class="badge-new">NEW</span>' : ''}${escapeHtml(titleShort)}</div>
                    <div class="item-id">${item.itemId}</div>
                </td>
                <td class="num-cell price">${item.price || '-'}</td>
                <td class="num-cell">${formatNumber(item.views)}</td>
                <td class="num-cell wants">${formatNumber(item.wants)}</td>
                <td class="num-cell">${formatNumber(item.favorites)}</td>
                <td class="num-cell">${formatNumber(item.comments)}</td>
                <td class="num-cell">${formatNumber(item.reviews)}</td>
                <td class="status-cell">
                    <span class="status-dot ${item.lastSeen > Date.now() - 86400000 ? 'online' : 'offline'}"></span>
                    <span class="check-count">${item.checkCount || 1}次</span>
                </td>
            </tr>`;
        }).join('');
        
        // 点击查看详情
        tbody.querySelectorAll('.item-row').forEach(row => {
            row.addEventListener('click', () => {
                const id = row.dataset.id;
                const item = monitorData.items[id];
                if (item) showItemDetail(item);
            });
        });
    }
    
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // ====== 渲染变更记录 ======
    function renderChanges(items) {
        const changeList = $('change-list');
        const filterNew = $('filter-new').checked;
        const filterTitle = $('filter-title').checked;
        const filterPrice = $('filter-price').checked;
        const filterStats = $('filter-stats').checked;
        
        const allChanges = [];
        
        for (const item of items) {
            if (!item.changes) continue;
            for (const c of item.changes) {
                let show = false;
                if (c.type === 'NEW' && filterNew) show = true;
                if (c.type === 'TITLE_CHANGE' && filterTitle) show = true;
                if (c.type === 'PRICE_CHANGE' && filterPrice) show = true;
                if (c.type === 'STATS_CHANGE' && filterStats) show = true;
                if (show) {
                    allChanges.push({ ...c, title: item.title, itemId: item.itemId });
                }
            }
            
            // 从历史记录提取变更
            if (item.history && item.history.length > 1) {
                for (let i = 1; i < item.history.length; i++) {
                    const prev = item.history[i-1];
                    const curr = item.history[i];
                    if (filterTitle && prev.title !== curr.title) {
                        allChanges.push({ type: 'TITLE_CHANGE', timestamp: curr.timestamp, title: item.title, itemId: item.itemId, message: `"${prev.title}" → "${curr.title}"` });
                    }
                    if (filterPrice && prev.price !== curr.price) {
                        allChanges.push({ type: 'PRICE_CHANGE', timestamp: curr.timestamp, title: item.title, itemId: item.itemId, message: `${prev.price} → ${curr.price}` });
                    }
                    if (filterStats) {
                        const statChanges = [];
                        if (prev.views !== curr.views) statChanges.push(`浏览:${prev.views||0}→${curr.views||0}`);
                        if (prev.wants !== curr.wants) statChanges.push(`想要:${prev.wants||0}→${curr.wants||0}`);
                        if (prev.favorites !== curr.favorites) statChanges.push(`收藏:${prev.favorites||0}→${curr.favorites||0}`);
                        if (prev.comments !== curr.comments) statChanges.push(`留言:${prev.comments||0}→${curr.comments||0}`);
                        if (prev.reviews !== curr.reviews) statChanges.push(`评价:${prev.reviews||0}→${curr.reviews||0}`);
                        if (statChanges.length > 0) {
                            allChanges.push({ type: 'STATS_CHANGE', timestamp: curr.timestamp, title: item.title, itemId: item.itemId, message: statChanges.join(' | ') });
                        }
                    }
                }
            }
        }
        
        // 按时间排序
        allChanges.sort((a, b) => b.timestamp - a.timestamp);
        
        if (allChanges.length === 0) {
            changeList.innerHTML = '<div class="empty-row">暂无变更记录</div>';
            return;
        }
        
        const typeLabels = {
            'NEW': '🆕 上新',
            'TITLE_CHANGE': '✏️ 标题变更',
            'PRICE_CHANGE': '💲 价格变更',
            'STATS_CHANGE': '📊 数据变更'
        };
        
        changeList.innerHTML = allChanges.slice(0, 100).map(c => `
            <div class="change-item change-${c.type.toLowerCase()}">
                <div class="change-header">
                    <span class="change-type">${typeLabels[c.type] || c.type}</span>
                    <span class="change-time">${formatTime(c.timestamp)}</span>
                </div>
                <div class="change-title">${escapeHtml(c.title || '')}</div>
                <div class="change-message">${c.message || ''}</div>
            </div>
        `).join('');
    }
    
    // ====== 渲染导出预览 ======
    function renderExportPreview(items) {
        const tbody = $('preview-body');
        const sorted = [...items].sort((a, b) => b.wants - a.wants).slice(0, 20);
        
        tbody.innerHTML = sorted.map(item => `
            <tr>
                <td title="${escapeHtml(item.title || '')}">${escapeHtml((item.title || '').substring(0, 20))}</td>
                <td>${item.price || '-'}</td>
                <td>${item.views || 0}</td>
                <td>${item.wants || 0}</td>
                <td>${item.favorites || 0}</td>
                <td>${item.comments || 0}</td>
                <td>${item.reviews || 0}</td>
                <td>${new Date(item.firstSeen).toLocaleDateString('zh-CN')}</td>
            </tr>
        `).join('');
    }
    
    // ====== 商品详情弹窗 ======
    function showItemDetail(item) {
        const modal = $('item-detail-modal');
        $('modal-title').textContent = item.title || '商品详情';
        
        const history = item.history || [];
        const latest = history.length > 0 ? history[history.length - 1] : item;
        
        let html = `
            <div class="detail-grid">
                <div class="detail-section">
                    <h4>基本信息</h4>
                    <div class="detail-row"><span>商品ID</span><span>${item.itemId}</span></div>
                    <div class="detail-row"><span>价格</span><span class="price">${item.price || '-'}</span></div>
                    <div class="detail-row"><span>首次发现</span><span>${new Date(item.firstSeen).toLocaleString('zh-CN')}</span></div>
                    <div class="detail-row"><span>最后更新</span><span>${new Date(item.lastSeen).toLocaleString('zh-CN')}</span></div>
                    <div class="detail-row"><span>检查次数</span><span>${item.checkCount || 1}</span></div>
                </div>
                <div class="detail-section">
                    <h4>数据统计</h4>
                    <div class="stat-row">
                        <div class="stat-item"><label>👁 浏览</label><span class="value">${formatNumber(latest.views)}</span></div>
                        <div class="stat-item"><label>❤️ 想要</label><span class="value wants">${formatNumber(latest.wants)}</span></div>
                        <div class="stat-item"><label>⭐ 收藏</label><span class="value">${formatNumber(latest.favorites)}</span></div>
                        <div class="stat-item"><label>💬 留言</label><span class="value">${formatNumber(latest.comments)}</span></div>
                        <div class="stat-item"><label>📝 评价</label><span class="value">${formatNumber(latest.reviews)}</span></div>
                    </div>
                </div>
                <div class="detail-section full-width">
                    <h4>链接</h4>
                    <a href="https://www.goofish.com/item?id=${item.itemId}" target="_blank" class="item-link">🔗 打开商品页面</a>
                </div>
            </div>
        `;
        
        // 添加历史趋势
        if (history.length > 1) {
            html += `
                <div class="detail-section full-width">
                    <h4>📈 历史趋势</h4>
                    <div class="history-table-wrap">
                        <table class="history-table">
                            <thead>
                                <tr>
                                    <th>时间</th><th>标题</th><th>价格</th><th>浏览</th><th>想要</th><th>收藏</th><th>留言</th><th>评价</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${history.slice(-20).reverse().map(h => `
                                    <tr>
                                        <td>${new Date(h.timestamp).toLocaleString('zh-CN')}</td>
                                        <td title="${escapeHtml(h.title || '')}">${escapeHtml((h.title || '').substring(0, 15))}</td>
                                        <td>${h.price || '-'}</td>
                                        <td>${h.views || 0}</td>
                                        <td>${h.wants || 0}</td>
                                        <td>${h.favorites || 0}</td>
                                        <td>${h.comments || 0}</td>
                                        <td>${h.reviews || 0}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }
        
        $('modal-body').innerHTML = html;
        modal.style.display = 'flex';
    }
    
    // ====== 事件绑定 ======
    
    // Tab 切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            $(`tab-${btn.dataset.tab}`).classList.add('active');
        });
    });
    
    // 刷新按钮
    $('refresh-btn').addEventListener('click', loadData);
    
    // 搜索过滤
    $('filter-input').addEventListener('input', (e) => {
        currentFilter = e.target.value;
        updateDashboard();
    });
    
    // 排序
    $('sort-select').addEventListener('change', (e) => {
        currentSort = e.target.value;
        updateDashboard();
    });
    
    // 变更过滤器
    ['filter-new', 'filter-title', 'filter-price', 'filter-stats'].forEach(id => {
        $(id).addEventListener('change', () => {
            renderChanges(Object.values(monitorData.items));
        });
    });
    
    // 导出 CSV
    $('export-csv-btn').addEventListener('click', async () => {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'EXPORT_DATA', format: 'csv' });
            if (response.success) {
                statusText.textContent = '✅ CSV 已导出';
            } else if (response.csvData) {
                // 如果下载失败，提供复制
                await navigator.clipboard.writeText(response.csvData);
                statusText.textContent = '✅ CSV 已复制到剪贴板';
            } else {
                statusText.textContent = '❌ 导出失败: ' + response.error;
            }
        } catch (err) {
            statusText.textContent = '❌ 导出失败: ' + err.message;
        }
    });
    
    // 导出 JSON
    $('export-json-btn').addEventListener('click', async () => {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'EXPORT_DATA', format: 'json' });
            statusText.textContent = response.success ? '✅ JSON 已导出' : '❌ 导出失败';
        } catch (err) {
            statusText.textContent = '❌ 导出失败: ' + err.message;
        }
    });
    
    // 设置面板
    $('settings-btn').addEventListener('click', async () => {
        const panel = $('settings-panel');
        panel.style.display = 'flex';
        
        // 加载当前设置
        const response = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' }).catch(() => null);
        if (response?.settings) {
            $('setting-keyword').value = response.settings.monitorKeyword || '';
            $('setting-interval').value = response.settings.checkInterval || 5;
            $('setting-notifications').checked = response.settings.enableNotifications !== false;
        }
    });
    
    $('setting-save-btn').addEventListener('click', async () => {
        const settings = {
            monitorKeyword: $('setting-keyword').value || 'zhaopenglong1314',
            checkInterval: parseInt($('setting-interval').value) || 5,
            enableNotifications: $('setting-notifications').checked
        };
        
        await chrome.runtime.sendMessage({ action: 'UPDATE_SETTINGS', settings });
        $('settings-panel').style.display = 'none';
        statusText.textContent = '✅ 设置已保存';
    });
    
    $('setting-cancel-btn').addEventListener('click', () => {
        $('settings-panel').style.display = 'none';
    });
    
    // 弹窗关闭
    document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
        el.addEventListener('click', () => {
            $('item-detail-modal').style.display = 'none';
        });
    });
    
    $('settings-panel').querySelector('.settings-overlay').addEventListener('click', () => {
        $('settings-panel').style.display = 'none';
    });
    
    // ====== 初始化加载 ======
    loadData();
    
    // 每60秒自动刷新
    setInterval(loadData, 60000);
});
