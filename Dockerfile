FROM node:20-slim

# 安装 Chromium（用于 CDP 远程调试和 x5sec 验证）
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    # 中文字体支持
    fonts-noto-cjk \
    fonts-wqy-zenhei \
    # 去掉多余包减少体积
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制项目文件
COPY package.json ./
RUN npm install

COPY server.mjs shop_monitor_direct.mjs ./
COPY public/ ./public/

# 数据持久化目录
VOLUME /app/data
VOLUME /app/exports
VOLUME /app/chrome-data

# 暴露端口
EXPOSE 3000 9222

# 启动脚本
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
