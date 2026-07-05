# 闲鱼店铺监控系统

输入店铺 ID，自动监控：上新、下架、标题变更、价格变更、浏览/想要/收藏/留言/评价数量

## 🚀 快速开始

### 方式一：Docker 部署（推荐，开箱即用）

```bash
# 1. 启动
docker compose up -d

# 2. 首次登录（仅需一次）
#    打开 http://localhost:9222
#    → 找到闲鱼页面 → 点击"登录"
#    → 扫码/账号登录
#    → 关闭页面

# 3. 开始监控
#    打开 http://localhost:3000
#    输入店铺ID → 开始监控
```

**后续使用只需：** `docker compose start`

### 方式二：本地部署（Windows）

```bash
# 1. 确保已安装 Node.js ≥ 18
# 2. 双击 start.bat
# 3. 浏览器打开 http://localhost:3000
```

## 📖 使用说明

1. **获取店铺ID**
   - 在闲鱼打开想监控的店铺
   - 地址栏 `userId=数字` 复制那个数字

2. **监控店铺**
   - 输入店铺ID，点击"开始监控"
   - 系统自动获取所有在售商品

3. **查看5维数据**
   - 点击"批量查统计"
   - 系统自动获取每个商品的浏览/想要/收藏/留言/评价

4. **导出数据**
   - CSV 导出（可用 Excel 打开）

## 🐳 Docker 部署详解

### 前置条件
- Docker Desktop 24+
- 内存建议 ≥ 1GB

### 首次登录流程

```
启动容器 → 打开 http://localhost:9222
                    ↓
       出现 Chrome DevTools 界面
                    ↓
       点击 "闲鱼" 标签页 → 看到登录页面
                    ↓
       输入账号密码 / 扫码登录
                    ↓
       登录成功 → 关闭 DevTools
                    ↓
       打开 http://localhost:3000 使用
```

**登录态会持久化在 Docker 卷中，下次重启不需要重新登录。**

### 数据持久化

| Docker 卷 | 内容 |
|-----------|------|
| `xianyu-data` | 店铺监控数据（JSON） |
| `xianyu-exports` | CSV 导出文件 |
| `xianyu-chrome` | Chrome 登录会话（关键！） |

### 常用命令

```bash
# 启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose stop

# 完全删除（会清空数据）
docker compose down -v
```

## ⚙️ 系统架构

```
用户浏览器 (http://localhost:3000)
        │
        ▼
  Node.js Web 服务 (server.mjs)
        │
        ├── 直连 MTOP API ──────→ 商品列表/上新/下架 (无需验证)
        │
        └── CDP → Chromium (容器内) ──→ pc.detail API (x5sec验证)
                 │
          闲鱼已登录
```

## 📁 项目文件

| 文件 | 说明 |
|------|------|
| `server.mjs` | Web 服务 |
| `shop_monitor_direct.mjs` | 命令行版 |
| `public/index.html` | 前端页面 |
| `Dockerfile` | Docker 构建 |
| `docker-compose.yml` | Docker 编排 |
| `start.bat` | Windows 一键启动 |
