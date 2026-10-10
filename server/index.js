'use strict';
/**
 * 橙曦澎湃 / Project Rootpi & Xiaocheng (Prax)
 * 门户网站 + 协同后台 —— 服务入口
 *
 * 零构建依赖：Express + Node 内置 SQLite。
 *   npm start         启动
 *   npm run seed      初始化数据（幂等）
 */

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');

const { DB_FILE, getSettings, get } = require('./db');
const auth = require('./auth');
const { seed, seedSettings } = require('./seed');
const siteRoutes = require('./routes/site');
const adminRoutes = require('./routes/admin');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', true);

/* ---------------------------------------------------------------- 安全响应头 */

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // 站点内有少量内联脚本（媒体库上传与首屏主题令牌），因此保留 unsafe-inline
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; ')
  );
  next();
});

/* ---------------------------------------------------------------- 基础解析 */

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

// 会话解析放在最前，让所有路由都能拿到 req.user
app.use(auth.attachUser);

// 定期清理过期会话（每小时）
setInterval(() => {
  try {
    auth.purgeExpired();
  } catch (_) {}
}, 3600 * 1000).unref();

/* ---------------------------------------------------------------- 静态资源 */

const STATIC_MAX_AGE = process.env.NODE_ENV === 'production' ? '7d' : 0;

app.use(
  express.static(PUBLIC_DIR, {
    maxAge: STATIC_MAX_AGE,
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      // HTML 永不缓存，避免后台改动后前台不刷新
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// 上传目录若被外置（容器挂卷），额外挂一个静态路由指向它
const UPLOAD_DIR = process.env.PRAX_UPLOAD_DIR
  ? path.resolve(process.env.PRAX_UPLOAD_DIR)
  : path.join(PUBLIC_DIR, 'uploads');
if (path.resolve(UPLOAD_DIR) !== path.resolve(path.join(PUBLIC_DIR, 'uploads'))) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: STATIC_MAX_AGE }));
}

/* ---------------------------------------------------------------- 路由 */

// 健康检查：供宝塔／负载均衡／PM2 探活使用。
// 只回报服务与数据库是否可用，不泄露任何内部信息。
app.get('/healthz', (req, res) => {
  try {
    const r = get('SELECT 1 AS ok');
    if (!r || Number(r.ok) !== 1) throw new Error('db probe failed');
    res.json({ ok: true, status: 'healthy', time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, status: 'unhealthy' });
  }
});

app.use(siteRoutes);
app.use(adminRoutes);

/* ---------------------------------------------------------------- 错误处理 */

// multer 之外的上传体积/语法错误
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message =
    status === 413
      ? '请求内容过大'
      : status === 400
      ? '请求格式不正确'
      : '服务器内部错误';

  if (status >= 500) {
    console.error('[prax] 未处理的错误：', err);
  }

  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ ok: false, error: message });
  }
  res.status(status).send(
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>出错了</title>
<style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#f6f5ef;color:#241a14;
display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}
h1{font-size:22px;margin:0 0 10px}p{color:#6b5748;margin:0 0 22px}
a{display:inline-block;padding:10px 22px;border-radius:999px;background:#c34c18;color:#fff;text-decoration:none}</style>
</head><body><div><h1>${message}</h1><p>状态码 ${status}</p><a href="/">返回首页</a></div></body></html>`
  );
});

/* ---------------------------------------------------------------- 启动 */

function boot() {
  // 首次运行自动灌入种子数据；同时始终补全缺失的设置项（幂等），
  // 保证新增的设置键（如 show_login_hint）在旧库上升级后也能生效。
  try {
    const { get } = require('./db');
    seedSettings();
    const r = get('SELECT COUNT(*) AS c FROM users');
    if (!r || Number(r.c) === 0) {
      console.log('检测到空数据库，正在初始化…');
      seed();
    }
  } catch (e) {
    console.error('初始化数据失败：', e.message);
  }

  const server = app.listen(PORT, HOST, () => {
    const s = getSettings();
    const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log('');
    console.log('  ┌──────────────────────────────────────────────────────┐');
    console.log('  │  橙曦澎湃 · Project Rootpi & Xiaocheng (Prax)        │');
    console.log('  └──────────────────────────────────────────────────────┘');
    console.log('');
    console.log(`  站点名称   ${s.site_name || '橙曦澎湃'}（${s.site_abbr || 'Prax'}）`);
    console.log(`  门户主页   http://${shown}:${PORT}/`);
    console.log(`  工坊子页   http://${shown}:${PORT}/atelier`);
    console.log(`  协同后台   http://${shown}:${PORT}/admin`);
    console.log('');
    console.log(`  数据库     ${path.relative(ROOT, DB_FILE).replace(/\\/g, '/')}`);
    // 上传目录可能被 PRAX_UPLOAD_DIR 外置，这里显示实际生效的路径
    console.log(
      `  上传目录   ${(path.relative(ROOT, UPLOAD_DIR) || UPLOAD_DIR).replace(/\\/g, '/')}`
    );
    console.log('');
    if (!fs.existsSync(DB_FILE)) {
      console.log('  提示：数据库文件尚未生成，请先运行 npm run seed');
    }
    console.log('  按 Ctrl+C 停止服务');
    console.log('');
  });

  // 端口占用 / 权限不足等监听错误：给清晰中文提示，而不是抛未捕获异常静默退出。
  // 这是「启动没多久就自己关了」最常见的根因 —— 端口被上一个没关干净的实例占着。
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('');
      console.error('  ┌────────────────────────────────────────────────────────────┐');
      console.error('  │  启动失败：端口被占用（EADDRINUSE）                         │');
      console.error('  └────────────────────────────────────────────────────────────┘');
      console.error('');
      console.error(`  端口 ${PORT} 已被其它进程占用，请先停掉它再启动：`);
      console.error('');
      console.error('    查占用进程：');
      console.error(`      Windows  netstat -ano | findstr :${PORT}`);
      console.error(`      Linux    netstat -tlnp | grep ${PORT}`);
      console.error('');
      console.error('    或换一个端口启动：');
      console.error(`      set PORT=3001 && npm start        (Windows CMD)`);
      console.error(`      $env:PORT=3001; npm start         (Windows PowerShell)`);
      console.error(`      PORT=3001 npm start               (Linux / macOS)`);
      console.error('');
      process.exit(1);
      return;
    }
    if (err.code === 'EACCES') {
      console.error('');
      console.error(`  启动失败：没有权限监听端口 ${PORT}（EACCES）。`);
      console.error('  Linux 上低于 1024 的端口通常需要 root 权限，或改用 1024 以上的端口。');
      console.error('');
      process.exit(1);
      return;
    }
    console.error('\n  启动失败：', err);
    process.exit(1);
  });

  const shutdown = (sig) => {
    console.log(`\n收到 ${sig}，正在关闭…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  boot();
}

module.exports = { app, boot };
