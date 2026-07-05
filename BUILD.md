# 构建开箱即用版

## 方案一：7z 自解压单文件（推荐，最简单）

用户只需下载一个 `.exe`，双击运行。

### 构建步骤

```bash
# 1. 下载 Node.js 便携版
#    访问 https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip
#    解压到 portable-node/ 目录

# 2. 安装依赖
npm install

# 3. 准备文件结构
xianyu-monitor/
├── node.exe              ← 便携版 Node.js
├── server.mjs
├── public/index.html
├── node_modules/         ← 已安装的依赖
├── start-portable.bat    ← 启动脚本
└── chrome-launcher.exe   ← (可选)Chrome启动辅助

# 4. 用 7-Zip 打包成自解压 exe
#    安装 7-Zip → 选中所有文件 → 添加到压缩包
#    → 压缩方式: 仅存储
#    → 创建自解压格式: 7z SFX (xianyu-monitor.exe)
#    → 解压后运行: start-portable.bat
```

### start-portable.bat 内容

```batch
@echo off
chcp 65001 >nul
title 闲鱼店铺监控

:: 使用便携版 Node.js
set PATH=%~dp0;%PATH%

:: 启动 Chrome（如果有的话）  
start "" chrome --remote-debugging-port=9222 --new-window https://www.goofish.com/

:: 启动服务
node server.mjs

:: 自动打开浏览器
start http://localhost:3000
```

### 最终产物

```
xianyu-monitor.exe  (~45MB)
   ├── node.exe              (便携版 Node.js, ~30MB)
   ├── server.mjs + 依赖     (项目文件, ~5MB)
   └── start-portable.bat    (启动脚本, ~1KB)
```

用户双击 → 自动解压 → 自动运行 → 打开浏览器

---

## 方案二：pkg 编译成单 exe（更专业）

```bash
# 1. 全局安装 pkg
npm install -g pkg

# 2. 编译
pkg server.mjs --targets node18-win-x64 --output xianyu-monitor.exe

# 3. 产物约 30MB（已含 Node.js 运行时）
```

**注意**：pkg 对 ESM 和 `ws` 原生模块的支持有限，可能需要额外配置。

---

## 方案三：Electron 打包（带完整 UI）

```bash
# 用 electron-builder 打包成安装包
npm install electron electron-builder --save-dev
# 配置 package.json 的 build 字段
# 构建: npx electron-builder build --win
```

产物为安装程序 `xianyu-monitor Setup.exe`（约 80MB，含 Chromium）

---

## 对比总结

| 方案 | 体积 | 依赖 | 用户体验 |
|:----|:----:|:----:|:---------|
| **7z 自解压** | ~45MB | 无 | ⭐⭐⭐ 双击即用 |
| **pkg 编译** | ~30MB | 无 | ⭐⭐⭐⭐ 单文件 |
| **Electron** | ~80MB | 无 | ⭐⭐⭐⭐⭐ 体验最好 |
| **Docker** | ~200MB | 需安装Docker | ⭐⭐ 适合开发者 |

**推荐 7z 自解压方案**——最简单、体积适中、用户无门槛。
