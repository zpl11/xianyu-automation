/**
 * 数据库层 - SQLite
 * 用户 / 监控 / 商品 / 历史趋势 / 变更记录
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'xianyu_data.db');

let db = null;

export function initDB() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      keyword TEXT DEFAULT '',
      seed_item_id TEXT DEFAULT '',
      seller_name TEXT DEFAULT '',
      interval_min INTEGER DEFAULT 30,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL,
      item_id TEXT NOT NULL,
      title TEXT,
      price TEXT,
      views INTEGER DEFAULT 0,
      wants INTEGER DEFAULT 0,
      favorites INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      reviews INTEGER DEFAULT 0,
      first_seen TEXT DEFAULT (datetime('now','localtime')),
      last_seen TEXT DEFAULT (datetime('now','localtime')),
      check_count INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE,
      UNIQUE(monitor_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      title TEXT,
      price TEXT,
      views INTEGER DEFAULT 0,
      wants INTEGER DEFAULT 0,
      favorites INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      reviews INTEGER DEFAULT 0,
      timestamp TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      message TEXT,
      timestamp TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_items_monitor ON items(monitor_id);
    CREATE INDEX IF NOT EXISTS idx_items_item_id ON items(item_id);
    CREATE INDEX IF NOT EXISTS idx_history_item ON history(item_id);
    CREATE INDEX IF NOT EXISTS idx_changes_item ON changes(item_id);
    CREATE INDEX IF NOT EXISTS idx_monitors_user ON monitors(user_id);
  `);

  console.log('[DB] 数据库已初始化');
  return db;
}

export function getDB() {
  if (!db) return initDB();
  return db;
}

// ========== 用户操作 ==========

export function createUser(username, passwordHash, role = 'user') {
  const stmt = getDB().prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
  try {
    const result = stmt.run(username, passwordHash, role);
    return { id: result.lastInsertRowid, username, role };
  } catch (e) {
    if (e.message.includes('UNIQUE')) return null;
    throw e;
  }
}

export function getUserByUsername(username) {
  return getDB().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function getUserById(id) {
  return getDB().prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id);
}

export function listUsers() {
  return getDB().prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
}

// ========== 监控配置 ==========

export function createMonitor(userId, keyword, intervalMin = 30, seedItemId = '', sellerName = '') {
  const stmt = getDB().prepare(
    'INSERT INTO monitors (user_id, keyword, seed_item_id, seller_name, interval_min) VALUES (?, ?, ?, ?, ?)'
  );
  const result = stmt.run(userId, keyword || '', seedItemId || '', sellerName || '', intervalMin);
  return { id: result.lastInsertRowid, userId, keyword, seedItemId, sellerName, intervalMin };
}

export function getMonitorsByUser(userId) {
  return getDB().prepare(`
    SELECT m.*, 
      (SELECT COUNT(*) FROM items WHERE monitor_id = m.id) as item_count,
      (SELECT MAX(last_seen) FROM items WHERE monitor_id = m.id) as last_check
    FROM monitors m WHERE m.user_id = ? ORDER BY m.created_at DESC
  `).all(userId);
}

export function getMonitorById(id) {
  return getDB().prepare('SELECT * FROM monitors WHERE id = ?').get(id);
}

export function updateMonitor(id, data) {
  const fields = [];
  const values = [];
  if (data.keyword !== undefined) { fields.push('keyword = ?'); values.push(data.keyword); }
  if (data.seed_item_id !== undefined) { fields.push('seed_item_id = ?'); values.push(data.seed_item_id); }
  if (data.seller_name !== undefined) { fields.push('seller_name = ?'); values.push(data.seller_name); }
  if (data.interval_min !== undefined) { fields.push('interval_min = ?'); values.push(data.interval_min); }
  if (data.is_active !== undefined) { fields.push('is_active = ?'); values.push(data.is_active); }
  if (fields.length === 0) return;
  values.push(id);
  getDB().prepare(`UPDATE monitors SET ${fields.join(',')} WHERE id = ?`).run(...values);
}

export function deleteMonitor(id) {
  getDB().prepare('DELETE FROM items WHERE monitor_id = ?').run(id);
  getDB().prepare('DELETE FROM monitors WHERE id = ?').run(id);
}

export function getAllActiveMonitors() {
  return getDB().prepare('SELECT * FROM monitors WHERE is_active = 1').all();
}

// ========== 商品数据 ==========

export function upsertItem(monitorId, itemData) {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM items WHERE monitor_id = ? AND item_id = ?').get(monitorId, itemData.itemId);
  const now = new Date().toISOString();

  if (existing) {
    // 检测变更
    const changes = [];
    if (existing.title !== itemData.title && itemData.title && existing.title) {
      changes.push({ item_id: existing.id, type: 'TITLE_CHANGE', message: `"${existing.title}" → "${itemData.title}"` });
    }
    if (existing.price !== itemData.price && itemData.price && existing.price) {
      changes.push({ item_id: existing.id, type: 'PRICE_CHANGE', message: `${existing.price} → ${itemData.price}` });
    }
    const statFields = ['views', 'wants', 'favorites', 'comments', 'reviews'];
    const statDiffs = [];
    for (const f of statFields) {
      const ov = existing[f] || 0;
      const nv = itemData[f] || 0;
      if (ov !== nv) statDiffs.push(`${f}:${ov}→${nv}`);
    }
    if (statDiffs.length > 0) {
      changes.push({ item_id: existing.id, type: 'STATS_CHANGE', message: statDiffs.join(' | ') });
    }

    // 更新商品
    db.prepare(`
      UPDATE items SET title=?, price=?, views=?, wants=?, favorites=?, comments=?, reviews=?,
      last_seen=?, check_count=check_count+1 WHERE id=?
    `).run(
      itemData.title || existing.title,
      itemData.price || existing.price,
      itemData.views ?? existing.views,
      itemData.wants ?? existing.wants,
      itemData.favorites ?? existing.favorites,
      itemData.comments ?? existing.comments,
      itemData.reviews ?? existing.reviews,
      now, existing.id
    );

    // 记录历史
    db.prepare(`
      INSERT INTO history (item_id, title, price, views, wants, favorites, comments, reviews) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(existing.id, itemData.title || existing.title, itemData.price || existing.price,
      itemData.views ?? existing.views, itemData.wants ?? existing.wants,
      itemData.favorites ?? existing.favorites, itemData.comments ?? existing.comments,
      itemData.reviews ?? existing.reviews);

    // 记录变更
    for (const ch of changes) {
      db.prepare('INSERT INTO changes (item_id, type, message) VALUES (?, ?, ?)').run(ch.item_id, ch.type, ch.message);
    }

    return { isNew: false, changes };
  } else {
    // 新商品
    const result = db.prepare(`
      INSERT INTO items (monitor_id, item_id, title, price, views, wants, favorites, comments, reviews, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(monitorId, itemData.itemId, itemData.title || '', itemData.price || '',
      itemData.views || 0, itemData.wants || 0, itemData.favorites || 0,
      itemData.comments || 0, itemData.reviews || 0, now, now);

    // 记录历史
    db.prepare(`
      INSERT INTO history (item_id, title, price, views, wants, favorites, comments, reviews) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(result.lastInsertRowid, itemData.title || '', itemData.price || '',
      itemData.views || 0, itemData.wants || 0, itemData.favorites || 0,
      itemData.comments || 0, itemData.reviews || 0);

    // 记录上新
    db.prepare('INSERT INTO changes (item_id, type, message) VALUES (?, ?, ?)').run(
      result.lastInsertRowid, 'NEW', '新商品上架');

    return { isNew: true, changes: [{ type: 'NEW' }] };
  }
}

export function getItemsByMonitor(monitorId) {
  return getDB().prepare(`
    SELECT * FROM items WHERE monitor_id = ? ORDER BY wants DESC, views DESC
  `).all(monitorId);
}

export function getItemById(id) {
  return getDB().prepare('SELECT * FROM items WHERE id = ?').get(id);
}

export function getItemHistory(itemId) {
  return getDB().prepare('SELECT * FROM history WHERE item_id = ? ORDER BY timestamp ASC').all(itemId);
}

export function getItemChanges(itemId) {
  return getDB().prepare('SELECT * FROM changes WHERE item_id = ? ORDER BY timestamp DESC').all(itemId);
}

export function getRecentChanges(monitorId, limit = 50) {
  return getDB().prepare(`
    SELECT c.*, i.title as item_title, i.monitor_id 
    FROM changes c JOIN items i ON c.item_id = i.id 
    WHERE i.monitor_id = ? 
    ORDER BY c.timestamp DESC LIMIT ?
  `).all(monitorId, limit);
}

export function getMonitorStats(monitorId) {
  const db = getDB();
  const items = db.prepare('SELECT * FROM items WHERE monitor_id = ?').all(monitorId);
  const totalItems = items.length;
  const totalViews = items.reduce((s, i) => s + (i.views || 0), 0);
  const totalWants = items.reduce((s, i) => s + (i.wants || 0), 0);
  const totalFavorites = items.reduce((s, i) => s + (i.favorites || 0), 0);
  const totalComments = items.reduce((s, i) => s + (i.comments || 0), 0);
  const totalReviews = items.reduce((s, i) => s + (i.reviews || 0), 0);
  const recentChanges = db.prepare(`
    SELECT COUNT(*) as cnt FROM changes c JOIN items i ON c.item_id = i.id 
    WHERE i.monitor_id = ? AND c.timestamp > datetime('now', '-1 day')
  `).get(monitorId);

  return { totalItems, totalViews, totalWants, totalFavorites, totalComments, totalReviews, recentChanges: recentChanges.cnt };
}

// ========== 管理员仪表盘 ==========

export function getAdminStats() {
  const db = getDB();
  return {
    totalUsers: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    totalMonitors: db.prepare('SELECT COUNT(*) as c FROM monitors').get().c,
    totalItems: db.prepare('SELECT COUNT(*) as c FROM items').get().c,
    totalChanges: db.prepare('SELECT COUNT(*) as c FROM changes').get().c,
  };
}

export default { initDB, getDB, createUser, getUserByUsername, getUserById, listUsers,
  createMonitor, getMonitorsByUser, getMonitorById, updateMonitor, deleteMonitor, getAllActiveMonitors,
  upsertItem, getItemsByMonitor, getItemById, getItemHistory, getItemChanges, getRecentChanges, getMonitorStats,
  getAdminStats };
