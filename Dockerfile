# 基于官方 Node 镜像；带 node:sqlite 需要 Node 22.5+，这里锁定 24
FROM node:24-alpine

# node:sqlite 在 Alpine(musl) 上需要 libstdc++ 运行时
RUN apk add --no-cache libstdc++

WORKDIR /app

# 只拷贝依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# 拷贝应用代码
COPY server ./server
COPY public ./public
COPY tools ./tools

# 数据与上传目录（用卷挂载以持久化）
RUN mkdir -p /app/data /app/public/uploads

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
# 数据与上传都放在 /app/data 下，方便用一个卷整体持久化
ENV PRAX_DATA_DIR=/app/data

EXPOSE 3000

# 启动前先确保数据已初始化（幂等，不会覆盖已有数据）
CMD ["sh", "-c", "node server/seed.js && node server/index.js"]
