// 闲鱼监控平台 - 前端SPA
const API = '/api';
let token = localStorage.getItem('token');
let currentUser = null;
let currentMonitorId = null;
let trendChart = null;

// ===== HTTP 请求 =====
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const resp = await fetch(API + path, { ...options, headers });
  if (resp.status === 401) { logout(); return null; }
  return resp.json();
}

// ===== 页面切换 =====
function showPage(page, data) {
  document.querySelectorAll('.page-content').forEach(p => p.style.display = 'none');
  const el = document.getElementById('page-' + page);
  if (el) el.style.display = 'block';
  if (page === 'dashboard') loadDashboard();
  if (page === 'monitors') loadMonitors();
  if (page === 'monitor-detail') loadMonitorDetail(data);
  if (page === 'item-detail') loadItemDetail(data);
  if (page === 'admin') loadAdmin();
}

document.querySelectorAll('[data-page]').forEach(a => {
  a.addEventListener('click', e => { e.preventDefault(); showPage(a.dataset.page); });
});

// ===== 登录 =====
async function login() {
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const result = await api('/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password })
  });
  if (result?.token) {
    token = result.token;
    localStorage.setItem('token', token);
    currentUser = result.user;
    enterApp();
  } else {
    document.getElementById('login-error').textContent = result?.error || '登录失败';
  }
}
document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') login();
});

function logout() {
  token = null;
  localStorage.removeItem('token');
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('main-page').style.display = 'none';
}
document.getElementById('logout-btn').addEventListener('click', logout);

// ===== 进入主界面 =====
async function enterApp() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('main-page').style.display = 'block';
  
  const me = await api('/auth/me');
  if (me) {
    currentUser = me;
    document.getElementById('nav-user').textContent = me.username;
    if (me.role === 'admin') {
      document.getElementById('admin-link').style.display = 'inline';
    }
  }
  showPage('dashboard');
}

// ===== 仪表盘 =====
async function loadDashboard() {
  const monitors = await api('/monitors') || [];
  let totalItems = 0, totalWants = 0, totalViews = 0;
  
  for (const m of monitors) {
    const stats = await api('/monitors/' + m.id + '/stats');
    if (stats) {
      totalItems += stats.totalItems || 0;
      totalWants += stats.totalWants || 0;
      totalViews += stats.totalViews || 0;
    }
  }
  
  document.getElementById('dashboard-stats').innerHTML = `
    <div class="stat-card"><div class="value">${monitors.length}</div><div class="label">监控关键词</div></div>
    <div class="stat-card"><div class="value">${totalItems}</div><div class="label">商品总数</div></div>
    <div class="stat-card"><div class="value">${fmtNum(totalViews)}</div><div class="label">总浏览</div></div>
    <div class="stat-card"><div class="value">${fmtNum(totalWants)}</div><div class="label">总想要</div></div>
  `;
  
  document.getElementById('dashboard-monitors').innerHTML = monitors.length === 0
    ? '<div class="empty">暂无监控，去"监控管理"添加</div>'
    : monitors.map(m => {
      const type = m.seed_item_id ? '🏪' : '🔍';
      const name = m.seller_name || m.keyword || m.seed_item_id || '?';
      return `<div class="monitor-card" onclick="showPage('monitor-detail',${m.id})">
        <div>
          <div class="keyword">${type} ${esc(name)}</div>
          <div class="meta">${m.item_count||0}个商品 | ${m.last_check ? '最后检查:'+formatTime(m.last_check) : '未检查'}</div>
        </div>
        <div class="meta">${m.is_active ? '🟢活跃' : '⭕暂停'}</div>
      </div>`;
    }).join('');
}

// ===== 监控管理 =====
async function loadMonitors() {
  const monitors = await api('/monitors') || [];
  document.getElementById('monitors-list').innerHTML = monitors.length === 0
    ? '<div class="empty">暂无监控，点击"新建监控"开始</div>'
    : monitors.map(m => {
        const type = m.seed_item_id ? '🏪店铺' : '🔍关键词';
        const name = m.seller_name || m.keyword || m.seed_item_id || '?';
        return `<div class="monitor-card">
          <div onclick="showPage('monitor-detail',${m.id})" style="flex:1">
            <div class="keyword">${type} ${esc(name)}</div>
            <div class="meta">${m.item_count||0}个商品 | 每${m.interval_min||30}分钟</div>
          </div>
          <div class="actions">
            <button class="btn" onclick="event.stopPropagation();toggleMonitor(${m.id},${m.is_active})">
              ${m.is_active ? '⏸暂停' : '▶激活'}</button>
            <button class="btn" onclick="event.stopPropagation();deleteMonitor(${m.id})">🗑删除</button>
          </div>
        </div>`;
      }).join('');
}

// ===== 模式切换 =====
window.toggleMonitorMode = function() {
  const mode = document.querySelector('input[name="monitor-mode"]:checked').value;
  document.getElementById('monitor-keyword-inputs').style.display = mode === 'keyword' ? 'block' : 'none';
  document.getElementById('monitor-store-inputs').style.display = mode === 'store' ? 'block' : 'none';
};

document.getElementById('add-monitor-btn').addEventListener('click', () => {
  const form = document.getElementById('add-monitor-form');
  form.style.display = form.style.display === 'none' ? 'flex' : 'none';
});
document.getElementById('cancel-monitor-btn').addEventListener('click', () => {
  document.getElementById('add-monitor-form').style.display = 'none';
});
document.getElementById('save-monitor-btn').addEventListener('click', async () => {
  const mode = document.querySelector('input[name="monitor-mode"]:checked').value;
  const interval_min = parseInt(document.getElementById('new-interval').value) || 30;
  
  if (mode === 'store') {
    const seed_item_id = document.getElementById('new-seed-item-id').value.trim();
    if (!seed_item_id) return alert('请输入商品ID');
    await api('/monitors', {
      method: 'POST',
      body: JSON.stringify({ seed_item_id, interval_min })
    });
    document.getElementById('new-seed-item-id').value = '';
  } else {
    const keyword = document.getElementById('new-keyword').value.trim();
    if (!keyword) return alert('请输入关键词');
    await api('/monitors', {
      method: 'POST',
      body: JSON.stringify({ keyword, interval_min })
    });
    document.getElementById('new-keyword').value = '';
  }
  
  document.getElementById('add-monitor-form').style.display = 'none';
  loadMonitors();
});

async function toggleMonitor(id, active) {
  await api('/monitors/' + id, {
    method: 'PUT', body: JSON.stringify({ is_active: active ? 0 : 1 })
  });
  loadMonitors();
}

async function deleteMonitor(id) {
  if (!confirm('确定删除此监控？')) return;
  await api('/monitors/' + id, { method: 'DELETE' });
  loadMonitors();
}

// ===== 监控详情 =====
async function loadMonitorDetail(monitorId) {
  currentMonitorId = monitorId;
  const monitor = await api('/monitors/' + monitorId);
  if (!monitor) return;
  
  document.getElementById('monitor-detail-header').innerHTML = `
    <h2>🔍 ${esc(monitor.keyword)}</h2>
  `;
  
  document.getElementById('export-csv-link').href = API + '/export/monitor/' + monitorId;
  document.getElementById('export-csv-link').addEventListener('click', () => {
    // 触发下载
    fetch(API + '/export/monitor/' + monitorId, {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(r => r.blob()).then(b => {
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url; a.download = '闲鱼监控_' + monitor.keyword + '.csv'; a.click();
    });
  });
  
  const stats = await api('/monitors/' + monitorId + '/stats') || {};
  document.getElementById('detail-stats').innerHTML = `
    <div class="stat-card"><div class="value">${stats.totalItems||0}</div><div class="label">商品数</div></div>
    <div class="stat-card"><div class="value">${fmtNum(stats.totalViews)}</div><div class="label">总浏览</div></div>
    <div class="stat-card"><div class="value">${fmtNum(stats.totalWants)}</div><div class="label">总想要</div></div>
    <div class="stat-card"><div class="value">${fmtNum(stats.totalFavorites)}</div><div class="label">总收藏</div></div>
    <div class="stat-card"><div class="value">${fmtNum(stats.totalComments)}</div><div class="label">总留言</div></div>
    <div class="stat-card"><div class="value">${fmtNum(stats.totalReviews)}</div><div class="label">总评价</div></div>
  `;
  
  // 商品列表
  const items = await api('/monitors/' + monitorId + '/items') || [];
  const filter = (document.getElementById('filter-input').value || '').toLowerCase();
  const filtered = filter ? items.filter(i => (i.title||'').toLowerCase().includes(filter)) : items;
  
  document.getElementById('items-tbody').innerHTML = filtered.length === 0
    ? '<tr><td colspan="8" class="empty">暂无数据</td></tr>'
    : filtered.map(i => `
      <tr onclick="showPage('item-detail',${i.id})">
        <td class="title-cell" title="${esc(i.title||'')}">${esc((i.title||'').substring(0,40))}</td>
        <td>${i.price||'-'}</td>
        <td class="num">${fmtNum(i.views)}</td>
        <td class="num high">${fmtNum(i.wants)}</td>
        <td class="num">${fmtNum(i.favorites)}</td>
        <td class="num">${fmtNum(i.comments)}</td>
        <td class="num">${fmtNum(i.reviews)}</td>
        <td>${(i.last_seen||'').substring(0,10)}</td>
      </tr>
    `).join('');
  
  // 变更记录
  const changes = await api('/monitors/' + monitorId + '/changes?limit=20') || [];
  document.getElementById('detail-changes').innerHTML = changes.length === 0 ? '' : `
    <h3>📋 最近变更</h3>
    ${changes.map(c => `
      <div class="change-item">
        <span class="time">${(c.timestamp||'').substring(0,16)}</span>
        <span class="type type-${c.type}">${typeLabel(c.type)}</span>
        ${esc((c.item_title||'').substring(0,24))}
        <span style="color:var(--sub)">${esc((c.message||'').substring(0,60))}</span>
      </div>
    `).join('')}
  `;
}

document.getElementById('back-to-monitors').addEventListener('click', () => showPage('monitors'));
document.getElementById('refresh-check-btn').addEventListener('click', async () => {
  document.getElementById('refresh-check-btn').textContent = '⏳ 检查中...';
  await api('/monitors/' + currentMonitorId + '/check', { method: 'POST' });
  setTimeout(() => {
    document.getElementById('refresh-check-btn').textContent = '🔄 手动检查';
    loadMonitorDetail(currentMonitorId);
  }, 3000);
});
document.getElementById('filter-input').addEventListener('input', () => {
  if (currentMonitorId) loadMonitorDetail(currentMonitorId);
});

// ===== 商品详情 + 趋势图 =====
async function loadItemDetail(itemId) {
  const item = await api('/items/' + itemId);
  if (!item) return;
  
  document.getElementById('item-detail-header').innerHTML = `
    <h2>📦 ${esc(item.title||'')}</h2>
    <div style="color:var(--sub);font-size:13px;margin-bottom:12px">
      ID: ${item.item_id} | 价格: ${item.price||'-'} | 
      👁${fmtNum(item.views)} ❤️${fmtNum(item.wants)} ⭐${fmtNum(item.favorites)} 
      💬${fmtNum(item.comments)} 📝${fmtNum(item.reviews)}
    </div>
  `;
  
  const history = await api('/items/' + itemId + '/history') || [];
  
  if (trendChart) trendChart.destroy();
  const ctx = document.getElementById('trend-chart').getContext('2d');
  
  if (history.length > 1) {
    trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: history.map(h => (h.timestamp||'').substring(5,16)),
        datasets: [
          { label: '浏览', data: history.map(h => h.views||0), borderColor: '#3b82f6', tension: 0.3 },
          { label: '想要', data: history.map(h => h.wants||0), borderColor: '#f97316', tension: 0.3 },
          { label: '收藏', data: history.map(h => h.favorites||0), borderColor: '#ffda00', tension: 0.3 },
          { label: '留言', data: history.map(h => h.comments||0), borderColor: '#4ade80', tension: 0.3 },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#8b949e' } } },
        scales: { x: { ticks: { color: '#8b949e' } }, y: { ticks: { color: '#8b949e' } } }
      }
    });
  } else {
    document.getElementById('trend-chart').parentElement.innerHTML = '<div class="empty">数据不足，暂无法显示趋势图（需要至少2次检查）</div>';
  }
  
  document.getElementById('item-history-table').innerHTML = `
    <h3>📜 历史记录</h3>
    <div class="table-wrap" style="max-height:300px">
    <table id="items-table"><thead><tr>
      <th>时间</th><th>价格</th><th>浏览</th><th>想要</th><th>收藏</th><th>留言</th><th>评价</th>
    </tr></thead><tbody>
      ${history.slice().reverse().map(h => `
        <tr><td>${(h.timestamp||'').substring(0,16)}</td><td>${h.price||'-'}</td>
        <td class="num">${h.views||0}</td><td class="num high">${h.wants||0}</td>
        <td class="num">${h.favorites||0}</td><td class="num">${h.comments||0}</td>
        <td class="num">${h.reviews||0}</td></tr>
      `).join('')}
    </tbody></table></div>
  `;
}

document.getElementById('back-to-monitor').addEventListener('click', () => {
  if (currentMonitorId) showPage('monitor-detail', currentMonitorId);
});

// ===== 管理后台 =====
async function loadAdmin() {
  const users = await api('/auth/users') || [];
  document.getElementById('users-list').innerHTML = `
    <h3>用户列表 (${users.length})</h3>
    ${users.map(u => `<div style="padding:4px 0;font-size:13px">${esc(u.username)} - ${u.role} (${u.created_at||''})</div>`).join('')}
  `;
}
document.getElementById('create-user-btn').addEventListener('click', async () => {
  const username = document.getElementById('new-user-username').value.trim();
  const password = document.getElementById('new-user-password').value;
  if (!username || !password) return;
  const result = await api('/auth/register', {
    method: 'POST', body: JSON.stringify({ username, password })
  });
  if (result?.error) { alert(result.error); return; }
  document.getElementById('new-user-username').value = '';
  document.getElementById('new-user-password').value = '';
  loadAdmin();
});

// ===== 工具函数 =====
function esc(s) { const d = document.createElement('div'); d.textContent = s||''; return d.innerHTML; }
function fmtNum(n) { n = parseInt(n) || 0; return n > 10000 ? (n/10000).toFixed(1) + '万' : n.toString(); }
function formatTime(t) { if (!t) return '-'; const d = new Date(t); return d.toLocaleString('zh-CN'); }
function typeLabel(t) { return {NEW:'🆕上新',TITLE_CHANGE:'✏️标题',PRICE_CHANGE:'💲价格',STATS_CHANGE:'📊数据'}[t]||t; }

// ===== 初始化 =====
if (token) {
  // 验证token
  api('/auth/me').then(me => {
    if (me) { currentUser = me; enterApp(); }
    else { document.getElementById('login-page').style.display = 'flex'; }
  });
} else {
  document.getElementById('login-page').style.display = 'flex';
}
