/**
 * 认证相关路由
 */
import { Router } from 'express';
import { createUser, getUserByUsername, getUserById, listUsers, getAdminStats } from '../db.js';
import { hashPassword, verifyPassword, generateToken, authMiddleware, adminMiddleware } from '../auth.js';

const router = Router();

// 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  
  const user = getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  
  const token = generateToken(user);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// 获取当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  const user = getUserById(req.user.id);
  res.json(user);
});

// 管理员: 创建用户
router.post('/register', authMiddleware, adminMiddleware, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  
  const user = createUser(username, hashPassword(password), role || 'user');
  if (!user) return res.status(409).json({ error: '用户名已存在' });
  
  res.json(user);
});

// 管理员: 用户列表
router.get('/users', authMiddleware, adminMiddleware, (req, res) => {
  res.json(listUsers());
});

// 管理员: 统计数据
router.get('/admin/stats', authMiddleware, adminMiddleware, (req, res) => {
  res.json(getAdminStats());
});

export default router;
