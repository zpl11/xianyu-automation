#!/bin/bash
set -e

echo "========================================"
echo "  闲鱼店铺监控系统 - Docker 启动"
echo "========================================"

# 确保目录存在
mkdir -p /app/data /app/exports /app/chrome-data

# 启动 Chromium（后台运行，用于 CDP）
echo "[启动] Chromium (远程调试端口 9222)..."
chromium \
    --headless \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --remote-debugging-port=9222 \
    --user-data-dir=/app/chrome-data \
    --window-size=1400,900 &
CHROME_PID=$!
echo "[OK] Chromium 已启动 (PID: $CHROME_PID)"

# 等待 Chrome 就绪
echo "[等待] Chromium 就绪..."
for i in $(seq 1 10); do
    if curl -s http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
        echo "[OK] Chromium 就绪"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "[警告] Chromium 未响应，继续启动..."
    fi
    sleep 1
done

# 如果 chrome-data 中有已保存的 session，直接导航到闲鱼
if [ -f /app/chrome-data/First Run ]; then
    echo "[恢复] 检测到已保存的登录会话"
    # 通过 CDP 创建一个标签页到闲鱼
    curl -s -X PUT "http://127.0.0.1:9222/json/new?https://www.goofish.com/" > /dev/null 2>&1 || true
else
    echo "[首次] 未检测到登录会话"
    echo "  请在浏览器打开 http://<本机IP>:9222 进行闲鱼登录"
    # 创建闲鱼首页标签页
    curl -s -X PUT "http://127.0.0.1:9222/json/new?https://www.goofish.com/" > /dev/null 2>&1 || true
fi

# 启动 Node.js Web 服务
echo "[启动] Web 服务 (端口 3000)..."
echo ""
echo "========================================"
echo "  服务已就绪!"
echo ""
echo "  📊 监控面板: http://localhost:3000"
echo "  🔗 Chrome调试: http://localhost:9222"
echo ""
echo "  首次使用步骤:"
echo "  1. 打开 http://localhost:9222 进入 Chrome 调试"
echo "  2. 点击闲鱼页面并登录（仅需一次）"
echo "  3. 登录后打开 http://localhost:3000"
echo "  4. 输入店铺ID开始监控"
echo ""
echo "  登录状态会保存在 Docker 卷中，下次重启无需重新登录"
echo "========================================"
echo ""

# 前台运行 Node.js
exec node /app/server.mjs
