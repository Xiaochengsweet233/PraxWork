# Prax 门户 —— Docker 部署与域名访问

## 为什么之前"域名拒绝连接"？

Docker 只把 prax 服务的 `3000` 端口暴露在**容器内部**，而你的域名默认访问的是
服务器的 `80`（HTTP）/ `443`（HTTPS）端口。中间少了一层反向代理，所以浏览器报
「该域名拒绝了我们的连接」。

修复方式：加一个 **NGINX 反向代理容器**，把 80/443 转发到 `prax:3000`。

## 快速开始（带域名）

```bash
# 1. 把 deploy/nginx/prax.conf 里的 prax.yourdomain.com 换成你的域名
# 2. 启动（会拉起 prax + nginx 两个容器）
docker compose up -d --build

# 3. 验证
curl http://你的域名/healthz
# 期望：{"ok":true,"status":"healthy",...}
```

## 目录结构

```
deploy/
  nginx/
    prax.conf                  # NGINX 反代配置（改域名 + 可加 HTTPS）
  README.md                    # 本文档
docker-compose.yml             # 编排：prax（应用）+ nginx（反代）
```

## 开启 HTTPS（自备证书）

如果你已经有 SSL 证书（如 Let's Encrypt 签发的 `fullchain.pem` 和 `privkey.pem`）：

1. 创建证书目录并放入证书：

   ```bash
   mkdir -p deploy/nginx/certs
   # 把 fullchain.pem 和 privkey.pem 放到 deploy/nginx/certs/ 下
   ```

2. 编辑 `deploy/nginx/prax.conf`，在末尾追加（或替换 server 80 块为 443 并保留 80 跳转）：

   ```nginx
   server {
       listen 443 ssl;
       server_name prax.yourdomain.com;
       ssl_certificate     /etc/nginx/certs/fullchain.pem;
       ssl_certificate_key /etc/nginx/certs/privkey.pem;
       location / {
           proxy_pass http://prax_upstream;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_set_header Connection "";
       }
   }
   ```

3. 取消 `docker-compose.yml` 里 nginx 服务的证书挂载注释：

   ```yaml
   - ./deploy/nginx/certs:/etc/nginx/certs:ro
   ```

4. 重启：`docker compose up -d`

## 仅本机调试（不用域名）

```bash
# 临时打开 prax 的宿主机端口映射（把 docker-compose.yml 里 prax 的 ports 注释打开）
# 然后：
curl http://localhost:3000/healthz
```

## 常见问题

- **改了 nginx 配置后**：`docker compose restart nginx`
- **改了应用代码后**：`./scripts/update.sh`（会自动重建并重启，数据不丢）
- **上传大文件失败**：`deploy/nginx/prax.conf` 里 `client_max_body_size` 已设为 256m，与应用端 200MB 上限匹配。
