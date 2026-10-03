'use strict';
/**
 * 后台页面路由 + 内容/OA API
 *
 * 设计要点：
 * - 页面由 RESOURCES 定义驱动，列表与表单自动生成，新增模块只改声明
 * - 所有写操作都做字段白名单过滤 + 权限校验 + 审计日志
 * - 上传仅接受图片，文件名重命名，避免路径穿越与脚本注入
 */

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const { all, get, run, getSettings, setSetting, parseJSON, toBool } = require('../db');
const R = require('../render');
const A = require('../admin-ui');
const auth = require('../auth');

const router = express.Router();
const U = A.RESOURCES;
const ROOT_DIR = path.join(__dirname, '..', '..');

// 上传目录可通过环境变量外置（容器里挂卷持久化时用得到）。
// 默认仍是 public/uploads，这样零配置直接跑也能用。
const UP_DIR = process.env.PRAX_UPLOAD_DIR
  ? path.resolve(process.env.PRAX_UPLOAD_DIR)
  : path.join(ROOT_DIR, 'public', 'uploads');
fs.mkdirSync(UP_DIR, { recursive: true });

/* ---------------------------------------------------------------- 上传配置 */

const ALLOWED_MIME = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/avif', '.avif'],
  ['image/svg+xml', '.svg'],
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UP_DIR),
    filename: (req, file, cb) => {
      const ext = ALLOWED_MIME.get(file.mimetype) || '.bin';
      const name = Date.now().toString(36) + '-' + require('node:crypto').randomBytes(4).toString('hex') + ext;
      cb(null, name);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('仅支持 PNG / JPEG / WebP / GIF / AVIF / SVG 图片'));
    }
    cb(null, true);
  },
});

/* ---------------------------------------------------------------- 工具 */

function countOf(table, where, ...params) {
  const r = get(`SELECT COUNT(*) AS c FROM ${table}${where ? ' WHERE ' + where : ''}`, ...params);
  return r ? Number(r.c) : 0;
}

/** 后台侧栏用的计数 */
function navCounts() {
  return {
    projects: countOf('projects'),
    showcases: countOf('showcases'),
    announcements: countOf('announcements'),
    friends: countOf('friends'),
    nav_items: countOf('nav_items'),
    pages: countOf('pages'),
    media: countOf('media'),
    users: countOf('users'),
    tasks_open: countOf('tasks', "status != 'done' AND status != 'archived'"),
    approvals_pending: countOf('approvals', "status = 'pending'"),
    messages_new: countOf('messages', 'handled = 0'),
  };
}

function ctxFor(req, extra) {
  return Object.assign(
    {
      user: req.user,
      can: (p) => auth.hasPerm(req.user, p),
      settings: getSettings(),
      path: req.path,
      counts: navCounts(),
    },
    extra || {}
  );
}

function sendPage(req, res, extra) {
  res.send(A.adminShell(ctxFor(req, extra)));
}

/** 生成唯一 slug */
function uniqueSlug(table, base, excludeId) {
  let s = String(base || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!s) s = 'i' + Date.now().toString(36);
  let candidate = s;
  let n = 2;
  for (;;) {
    const row = excludeId
      ? get(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`, candidate, excludeId)
      : get(`SELECT id FROM ${table} WHERE slug = ?`, candidate);
    if (!row) return candidate;
    candidate = `${s}-${n++}`;
    if (n > 200) return `${s}-${Date.now().toString(36)}`;
  }
}

/**
 * 依据资源定义把请求体转成可写库的值。
 * 只接收定义中出现的字段，避免越权写入。
 */
function coerceBody(res, body, { isCreate }) {
  const out = {};
  for (const f of res.fields) {
    if (f.type === 'static') continue;

    // 密码字段：编辑时留空 = 不修改
    if (f.type === 'password') {
      const v = String(body[f.name] === undefined ? '' : body[f.name]);
      if (isCreate) {
        if (v) out.password_plain = v;
      } else if (v) {
        out.password_plain = v;
      }
      continue;
    }

    if (!(f.name in body)) continue;
    const raw = body[f.name];

    if (f.type === 'bool') {
      out[f.name] = raw === true || raw === '1' || raw === 1 || raw === 'true' || raw === 'on' ? 1 : 0;
      continue;
    }

    if (f.type === 'number') {
      const n = Number(raw);
      out[f.name] = Number.isFinite(n) ? n : 0;
      continue;
    }

    if (f.type === 'tags') {
      let arr = [];
      if (Array.isArray(raw)) arr = raw.map((x) => String(x).trim()).filter(Boolean);
      else arr = String(raw || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean);
      out[f.name] = JSON.stringify(arr.slice(0, 20));
      continue;
    }

    if (f.type === 'select') {
      const v = String(raw === undefined || raw === null ? '' : raw);
      const opts = A.optionsFor(f, null);
      // 动态选项（关联项目/成员）允许空字符串
      if (opts.some((o) => String(o.value) === v)) {
        out[f.name] = f.options === 'projects' || f.options === 'users' ? (v === '' ? null : Number(v)) : v;
      } else if (f.options === 'projects' || f.options === 'users') {
        out[f.name] = null;
      }
      continue;
    }

    out[f.name] = String(raw === undefined || raw === null ? '' : raw).trim();
  }
  return out;
}

/** 把布尔列读成普通值（列表/表单共用） */
function normalizeRow(res, row) {
  if (!row) return null;
  const o = Object.assign({}, row);
  for (const f of res.fields) {
    if (f.type === 'bool') o[f.name] = toBool(o[f.name]) ? 1 : 0;
    if (f.type === 'tags') {
      const arr = parseJSON(o[f.name], []);
      o[f.name] = Array.isArray(arr) ? arr : [];
    }
  }
  return o;
}

function requireRes(req, res, next) {
  const res_ = U[req.params.resource];
  if (!res_) return res.status(404).json({ ok: false, error: '未知的资源类型' });
  req.resDef = res_;
  next();
}

/* ================================================================ 登录 */

router.get('/admin/login', (req, res) => {
  if (req.user) return res.redirect('/admin');
  const s = getSettings();
  const body = `
<div class="login-page">
  <div class="login-art">
    <img class="login-art__wheel" src="/assets/pattern/citrus-wheel.svg" alt="" aria-hidden="true">
    <div class="login-art__in">
      <img class="mark" src="/assets/brand/logo-mark.png" alt="">
      <h1>${R.esc(s.site_name || '橙曦澎湃')}</h1>
      <p>${R.esc(s.site_name_en || '')} · 协同管理后台。在这里维护项目链接、首页展示、工坊内容与团队协同。</p>
      <div class="login-art__features">
        <div class="login-art__feat">${R.icon('box', 18)}项目链接与首页展示开关</div>
        <div class="login-art__feat">${R.icon('palette', 18)}工坊内容与媒体库</div>
        <div class="login-art__feat">${R.icon('clipboard', 18)}任务、审批与公告</div>
        <div class="login-art__feat">${R.icon('shield', 18)}角色权限与操作日志</div>
      </div>
    </div>
  </div>
  <div class="login-form-wrap">
    <div class="login-card">
      <div class="login-card__brand">
        <img src="/assets/brand/logo-mark.png" alt="">
        <span>
          <b>登录协同后台</b>
          <i>${R.esc(s.site_abbr || 'Prax')} Workspace</i>
        </span>
      </div>
      <div class="login-error" id="loginError"></div>
      <form id="loginForm">
        <div class="field">
          <label for="lg-user">账号</label>
          <input class="input" id="lg-user" name="username" required autocomplete="username" data-autofocus placeholder="请输入账号">
        </div>
        <div class="field">
          <label for="lg-pwd">密码</label>
          <input class="input" id="lg-pwd" name="password" type="password" required autocomplete="current-password" placeholder="请输入密码">
        </div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">${R.icon('shield', 18)}登录</button>
      </form>
      <div class="login-hint">
        <b>首次使用</b>：默认管理员账号为 <span class="mono">admin</span>，初始密码 <span class="mono">admin123</span>。登录后请立即在「成员与权限」中修改密码。
      </div>
      <div style="text-align:center;margin-top:18px">
        <a class="btn btn-ghost btn-sm" href="/">${R.icon('home', 15)}返回门户</a>
      </div>
    </div>
  </div>
</div>`;

  res.send(
    R.layout({
      page: 'login',
      bodyClass: '',
      title: '登录',
      styles: ['/assets/css/admin.css'],
      settings: s,
      user: null,
      body,
    })
  );
});

router.post('/api/auth/login', express.json({ limit: '16kb' }), (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: '请填写账号与密码' });
  }
  const u = get('SELECT * FROM users WHERE username = ?', String(username).trim());
  if (!u || !auth.verifyPassword(password, u.password_hash)) {
    auth.logAudit({ user: null, headers: req.headers, socket: req.socket }, 'login_failed', 'user', String(username), '账号或密码错误');
    run(
      `INSERT INTO audit_logs (user_id, username, action, target_type, target_id, detail, ip)
       VALUES (?,?,?,?,?,?,?)`,
      u ? u.id : null,
      String(username).slice(0, 60),
      'login_failed',
      'user',
      String(username).slice(0, 60),
      '账号或密码错误',
      auth.clientIp(req)
    );
    return res.status(401).json({ ok: false, error: '账号或密码错误' });
  }
  if (u.status !== 'active') {
    return res.status(403).json({ ok: false, error: '该账号已被停用，请联系管理员' });
  }

  const { token } = auth.createSession(u.id, {
    userAgent: req.headers['user-agent'] || '',
    ip: auth.clientIp(req),
  });
  run(`UPDATE users SET last_login_at = datetime('now','localtime') WHERE id = ?`, u.id);
  auth.setSessionCookie(res, token, new Date(Date.now() + 7 * 86400 * 1000));
  auth.logAudit(
    { user: { id: u.id, username: u.username }, headers: req.headers, socket: req.socket },
    'login',
    'user',
    u.id,
    '登录成功'
  );

  res.json({ ok: true, redirect: '/admin', user: { id: u.id, name: u.display_name || u.username, role: u.role } });
});

router.post('/api/auth/logout', (req, res) => {
  if (req.user) {
    auth.logAudit(req, 'logout', 'user', req.user.id, '退出登录');
  }
  auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.json({ ok: true, message: '已退出登录' });
});

router.get('/admin/logout', (req, res) => {
  auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.redirect('/admin/login');
});

/* ================================================================ 工作台 */

router.get('/admin', auth.requireAuth, (req, res) => {
  const s = req.user;
  const u = req.user;

  const stats = [
    { label: '项目', value: countOf('projects'), meta: `${countOf('projects', 'visible = 1')} 项对外展示`, icon: 'box' },
    { label: '工坊内容', value: countOf('showcases'), meta: `${countOf('showcases', 'visible = 1')} 项对外展示`, icon: 'palette' },
    { label: '进行中任务', value: countOf('tasks', "status = 'doing'"), meta: `共 ${countOf('tasks')} 个任务`, icon: 'clipboard' },
    { label: '待审批', value: countOf('approvals', "status = 'pending'"), meta: `共 ${countOf('approvals')} 条`, icon: 'check' },
  ];

  const myTasks = all(
    `SELECT t.*, p.title AS project_title FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.status NOT IN ('done','archived') AND (t.assignee_id = ? OR t.assignee_id IS NULL)
     ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.id DESC
     LIMIT 6`,
    u.id
  );

  const recentLogs = all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 8');
  const pendingApprovals = all(
    `SELECT a.*, us.display_name AS applicant_name FROM approvals a
     LEFT JOIN users us ON us.id = a.applicant_id
     WHERE a.status = 'pending' ORDER BY a.id DESC LIMIT 5`
  );
  const latestMessages = all('SELECT * FROM messages ORDER BY id DESC LIMIT 4');

  const quick = [
    ['/admin/projects/new', 'plus', '新建项目', '配置链接与首页展示'],
    ['/admin/showcases/new', 'sparkle', '新建工坊内容', '设计副产品与联动'],
    ['/admin/announcements/new', 'megaphone', '发布公告', '同步站内动态'],
    ['/admin/media', 'image', '媒体库', '上传与管理配图'],
    ['/admin/settings', 'settings', '站点设置', '站点名称与首页开关'],
    ['/admin/board', 'grid', '任务看板', '按状态查看任务'],
  ];

  const body = `
<div class="stat-grid">
  ${stats
    .map(
      (st) => `<div class="stat">
    <div class="stat__label">${R.icon(st.icon, 13)} ${R.esc(st.label)}</div>
    <div class="stat__value">${R.esc(String(st.value))}</div>
    <div class="stat__meta">${R.esc(st.meta)}</div>
  </div>`
    )
    .join('')}
</div>

<div class="dash-grid">
  <div>
    <div class="panel">
      <div class="panel__head">
        <h3>我的待办</h3>
        <span class="toolbar__spacer"></span>
        <a class="btn btn-ghost btn-sm" href="/admin/tasks">全部任务</a>
      </div>
      <div class="panel__body">
        ${
          myTasks.length
            ? `<div class="timeline">${myTasks
                .map(
                  (t) => `<div class="tl-item">
          <span class="tl-dot">${R.icon(t.status === 'doing' ? 'bolt' : 'clock', 15)}</span>
          <div class="tl-body">
            <b>${R.esc(t.title)}</b>
            <span>${R.esc(t.project_title || '未关联项目')} · 截止 ${R.esc(t.due_date || '未设置')}</span>
            <div class="row-inline" style="margin-top:7px">
              ${R.badge(t.priority)}
              ${R.statusBadge(t.status)}
              <span class="muted" style="font-size:12px">进度 ${Number(t.progress) || 0}%</span>
            </div>
            <div class="progress" style="margin-top:8px"><i style="width:${Math.max(
              0,
              Math.min(100, Number(t.progress) || 0)
            )}%"></i></div>
          </div>
        </div>`
                )
                .join('')}</div>`
            : `<div class="empty">${R.icon('check', 30)}<p>当前没有待办，辛苦了。</p></div>`
        }
      </div>
    </div>

    <div class="panel">
      <div class="panel__head"><h3>最近操作</h3></div>
      <div class="panel__body">
        ${
          recentLogs.length
            ? recentLogs
                .map(
                  (l) => `<div class="log-line">
          <span class="log-time">${R.fmtDate(l.created_at, true)}</span>
          <span class="log-user">${R.esc(l.username || '系统')}</span>
          <span class="log-act">${R.esc(l.action)}</span>
          <span class="log-detail">${R.esc(R.truncate(l.detail || l.target_type + ' #' + l.target_id, 60))}</span>
        </div>`
                )
                .join('')
            : '<div class="muted">暂无记录</div>'
        }
      </div>
    </div>
  </div>

  <div>
    <div class="panel">
      <div class="panel__head"><h3>快捷入口</h3></div>
      <div class="panel__body">
        <div class="quick-grid">
          ${quick
            .map(
              (q) => `<a class="quick" href="${R.escAttr(q[0])}">${R.icon(q[1], 20)}<b>${R.esc(q[2])}</b><span>${R.esc(
                q[3]
              )}</span></a>`
            )
            .join('')}
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel__head">
        <h3>待审批</h3>
        <span class="toolbar__spacer"></span>
        <a class="btn btn-ghost btn-sm" href="/admin/approvals">全部</a>
      </div>
      <div class="panel__body">
        ${
          pendingApprovals.length
            ? pendingApprovals
                .map(
                  (a) => `<div class="log-line" style="align-items:center">
          <span style="min-width:0;flex:1">
            <b style="font-size:14px">${R.esc(a.title)}</b>
            <div class="muted" style="font-size:12.5px">${R.esc(a.applicant_name || '—')} · ${R.esc(a.kind)}${
                    Number(a.amount) > 0 ? ' · ¥' + Number(a.amount) : ''
                  }</div>
          </span>
          <a class="btn btn-ghost btn-sm" href="/admin/approvals/${a.id}">处理</a>
        </div>`
                )
                .join('')
            : '<div class="muted">没有待审批事项。</div>'
        }
      </div>
    </div>

    <div class="panel">
      <div class="panel__head">
        <h3>最新留言</h3>
        <span class="toolbar__spacer"></span>
        <a class="btn btn-ghost btn-sm" href="/admin/messages">全部</a>
      </div>
      <div class="panel__body">
        ${
          latestMessages.length
            ? latestMessages
                .map(
                  (m) => `<div class="log-line" style="display:block">
          <b style="font-size:14px">${R.esc(m.subject || '(无主题)')}</b>
          <div class="muted" style="font-size:12.5px">${R.esc(m.name)} · ${R.timeAgo(m.created_at)}</div>
        </div>`
                )
                .join('')
            : '<div class="muted">暂无留言。</div>'
        }
      </div>
    </div>
  </div>
</div>`;

  sendPage(req, res, {
    pageTitle: `你好，${req.user.display_name || req.user.username}`,
    pageSub: '这是当前站点的整体情况',
    body,
  });
});

/* ================================================================ 通用资源页面
 *
 * 注意：本函数必须在所有「固定路径」的后台页面（/admin/board、/admin/media、
 * /admin/messages、/admin/audit、/admin/settings）之后调用，
 * 否则 /admin/:resource 会抢先吃掉这些路径。见文件末尾的 mountResourceRoutes()。
 */

function mountResourceRoutes() {
router.get('/admin/:resource', auth.requireAuth, requireRes, (req, res, next) => {
  const resDef = req.resDef;
  if (!auth.hasPerm(req.user, resDef.perm)) {
    return next();
  }

  const q = String(req.query.q || '').trim();
  let sql = `SELECT * FROM ${resDef.key}`;
  const params = [];
  if (q && resDef.searchCols && resDef.searchCols.length) {
    sql += ' WHERE ' + resDef.searchCols.map((c) => `${c} LIKE ?`).join(' OR ');
    resDef.searchCols.forEach(() => params.push(`%${q}%`));
  }
  sql += ` ORDER BY ${resDef.orderBy}`;

  const list = all(sql, ...params).map((r) => normalizeRow(resDef, r));
  const canWrite = auth.hasPerm(req.user, resDef.perm);

  const extra = [];
  if (resDef.key === 'approvals') extra.push(['approvals?status=pending', '仅看待审批']);
  if (resDef.key === 'tasks') extra.push(['board', '切换看板视图']);

  const body = `
<div class="page-head">
  <div class="muted" style="font-size:13px">${
    q ? `搜索「${R.esc(q)}」命中 ${list.length} 条` : ''
  }</div>
  <div class="page-head__act">
    ${extra
      .map((e) => `<a class="btn btn-ghost btn-sm" href="/admin/${e[0]}">${R.esc(e[1])}</a>`)
      .join('')}
    ${
      canWrite
        ? `<a class="btn btn-primary btn-sm" href="/admin/${resDef.key}/new">${R.icon('plus', 15)}新建${R.esc(
            resDef.single
          )}</a>`
        : ''
    }
  </div>
</div>

<div class="toolbar">
  <div class="search-box">
    ${R.icon('search', 16)}
    <input class="input" id="tableSearch" placeholder="在当前列表中筛选…">
  </div>
  <span class="muted" style="font-size:12.5px">支持即时筛选，输入关键字即可</span>
</div>

${A.resourceList(
  { can: (p) => auth.hasPerm(req.user, p), user: req.user },
  resDef,
  list
)}
<div class="empty" id="tableNone" hidden>${R.icon('search', 30)}<p>没有匹配的记录。</p></div>`;

  sendPage(req, res, {
    pageTitle: resDef.title,
    pageSub: `${resDef.permLabel} · 共 ${list.length} 条`,
    body,
  });
});

router.get('/admin/:resource/new', auth.requireAuth, requireRes, (req, res, next) => {
  const resDef = req.resDef;
  if (!auth.hasPerm(req.user, resDef.perm)) return next();
  const media = all('SELECT * FROM media ORDER BY id DESC LIMIT 40');
  const body =
    A.resourceForm({ can: (p) => auth.hasPerm(req.user, p), user: req.user }, resDef, null) +
    A.mediaPickerModal(media);
  sendPage(req, res, { pageTitle: `新建${resDef.single}`, pageSub: resDef.title, body });
});

router.get('/admin/:resource/:id', auth.requireAuth, requireRes, (req, res, next) => {
  const resDef = req.resDef;
  if (!auth.hasPerm(req.user, resDef.perm)) return next();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next();

  const raw = get(`SELECT * FROM ${resDef.key} WHERE id = ?`, id);
  if (!raw) return next();
  const row = normalizeRow(resDef, raw);

  const media = all('SELECT * FROM media ORDER BY id DESC LIMIT 40');
  const body =
    A.resourceForm({ can: (p) => auth.hasPerm(req.user, p), user: req.user }, resDef, row) +
    A.mediaPickerModal(media);
  sendPage(req, res, {
    pageTitle: `编辑${resDef.single}`,
    pageSub: row.title || row.name || row.label || row.username || `#${id}`,
    body,
  });
});
}

/* ================================================================ 任务看板 */

router.get('/admin/board', auth.requireAuth, auth.requirePerm('oa'), (req, res) => {
  const cols = [
    { key: 'todo', label: '待开始', icon: 'clock' },
    { key: 'doing', label: '进行中', icon: 'bolt' },
    { key: 'review', label: '待审核', icon: 'eye' },
    { key: 'done', label: '已完成', icon: 'check' },
  ];

  const tasks = all(
    `SELECT t.*, u.display_name AS assignee_name, p.title AS project_title
     FROM tasks t
     LEFT JOIN users u ON u.id = t.assignee_id
     LEFT JOIN projects p ON p.id = t.project_id
     ORDER BY t.sort_order, t.id DESC`
  );

  const body = `
<div class="page-head">
  <div class="muted" style="font-size:13px">共 ${tasks.length} 个任务</div>
  <div class="page-head__act">
    <a class="btn btn-ghost btn-sm" href="/admin/tasks">列表视图</a>
    <a class="btn btn-primary btn-sm" href="/admin/tasks/new">${R.icon('plus', 15)}新建任务</a>
  </div>
</div>
<div class="board">
  ${cols
    .map((c) => {
      const items = tasks.filter((t) => t.status === c.key);
      return `<div class="board__col">
    <div class="board__head">${R.icon(c.icon, 16)}<b>${R.esc(c.label)}</b><span class="badge badge-muted">${
        items.length
      }</span></div>
    ${
      items.length
        ? items
            .map(
              (t) => `<a class="board__card" href="/admin/tasks/${t.id}">
      <div class="board__title">${R.esc(t.title)}</div>
      <div class="progress"><i style="width:${Math.max(0, Math.min(100, Number(t.progress) || 0))}%"></i></div>
      <div class="board__meta">
        ${R.badge(t.priority)}
        <span>${R.icon('users', 12)} ${R.esc(t.assignee_name || '未指派')}</span>
        ${t.due_date ? `<span>${R.icon('clock', 12)} ${R.esc(t.due_date)}</span>` : ''}
      </div>
      ${t.project_title ? `<div class="board__meta">${R.icon('box', 12)} ${R.esc(t.project_title)}</div>` : ''}
    </a>`
            )
            .join('')
        : `<div class="muted" style="font-size:13px;padding:10px 4px">暂无任务</div>`
    }
  </div>`;
    })
    .join('')}
</div>`;

  sendPage(req, res, { pageTitle: '任务看板', pageSub: '按状态纵览所有任务', body });
});

/* ================================================================ 媒体库 */

router.get('/admin/media', auth.requireAuth, auth.requirePerm('media'), (req, res) => {
  const list = all('SELECT * FROM media ORDER BY id DESC LIMIT 200');

  const body = `
<div class="page-head">
  <div class="muted" style="font-size:13px">共 ${list.length} 个文件（最多显示最近 200 个）</div>
</div>

<div class="panel">
  <div class="panel__head"><h3>上传图片</h3></div>
  <div class="panel__body">
    <label class="dropzone" id="dropzone">
      <input type="file" id="fileInput" accept="image/*" multiple hidden>
      ${R.icon('image', 30)}
      <b>点击选择，或把图片拖到这里</b>
      <span>支持 PNG / JPEG / WebP / GIF / AVIF / SVG，单个不超过 12 MB</span>
    </label>
    <div id="uploadList" class="row-inline" style="margin-top:14px"></div>
  </div>
</div>

<div class="panel">
  <div class="panel__head"><h3>媒体库</h3><span class="toolbar__spacer"></span>
    <span class="muted" style="font-size:12.5px">点击「复制链接」可直接用于内容字段</span>
  </div>
  <div class="panel__body">
    ${
      list.length
        ? `<div class="media-grid">${list
            .map(
              (m) => `<div class="media-card">
      <img src="${R.escAttr(m.url)}" alt="${R.escAttr(m.original_name)}" loading="lazy">
      <div class="media-card__body">
        <div class="media-card__name" title="${R.escAttr(m.original_name || m.filename)}">${R.esc(
                R.truncate(m.original_name || m.filename, 24)
              )}</div>
        <div class="media-card__meta"><span>${R.fmtBytes(m.size)}</span>${
                m.width ? `<span>${m.width}×${m.height}</span>` : ''
              }<span>${R.timeAgo(m.created_at)}</span></div>
      </div>
      <div class="media-card__act">
        <button class="btn btn-ghost btn-sm" type="button" data-copy="${R.escAttr(m.url)}">复制链接</button>
        <button class="btn btn-ghost btn-sm" type="button" data-action="delete" data-url="/api/media/${
          m.id
        }" data-confirm="确定删除这张图片吗？">删除</button>
      </div>
    </div>`
            )
            .join('')}</div>`
        : `<div class="empty">${R.icon('image', 32)}<p>媒体库还是空的，先上传一张图片吧。</p></div>`
    }
  </div>
</div>

<script>
(function(){
  var dz = document.getElementById('dropzone');
  var input = document.getElementById('fileInput');
  var listBox = document.getElementById('uploadList');

  function doUpload(files){
    if (!files || !files.length) return;
    var fd = new FormData();
    for (var i=0;i<files.length;i++) fd.append('files', files[i]);
    listBox.innerHTML = '<span class="muted">正在上传 ' + files.length + ' 个文件…</span>';
    fetch('/api/media/upload', { method:'POST', body: fd, credentials:'same-origin' })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (!d.ok) throw new Error(d.error || '上传失败');
        window.praxToast('已上传 ' + d.items.length + ' 个文件', 'ok');
        setTimeout(function(){ location.reload(); }, 600);
      })
      .catch(function(e){
        listBox.innerHTML = '';
        window.praxToast(e.message, 'err');
      });
  }

  dz.addEventListener('click', function(){ input.click(); });
  input.addEventListener('change', function(){ doUpload(input.files); });
  ['dragenter','dragover'].forEach(function(ev){
    dz.addEventListener(ev, function(e){ e.preventDefault(); dz.classList.add('is-over'); });
  });
  ['dragleave','drop'].forEach(function(ev){
    dz.addEventListener(ev, function(e){ e.preventDefault(); dz.classList.remove('is-over'); });
  });
  dz.addEventListener('drop', function(e){
    if (e.dataTransfer && e.dataTransfer.files) doUpload(e.dataTransfer.files);
  });

  // 复制链接
  document.addEventListener('click', function(e){
    var b = e.target.closest('[data-copy]');
    if (!b) return;
    var text = b.getAttribute('data-copy');
    var done = function(){ window.praxToast('链接已复制：' + text, 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function(){ fallback(text, done); });
    } else { fallback(text, done); }
  });

  function fallback(text, done){
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch(_) { window.prompt('复制这个链接：', text); }
    document.body.removeChild(ta);
  }
})();
</script>`;

  sendPage(req, res, { pageTitle: '媒体库', pageSub: '上传并管理站点配图', body });
});

/* ================================================================ 留言 */

router.get('/admin/messages', auth.requireAuth, auth.requirePerm('messages'), (req, res) => {
  const list = all('SELECT * FROM messages ORDER BY id DESC LIMIT 200');
  const body = `
<div class="page-head">
  <div class="muted" style="font-size:13px">共 ${list.length} 条留言 · 未处理 ${countOf(
    'messages',
    'handled = 0'
  )} 条</div>
</div>
${
  list.length
    ? list
        .map(
          (m) => `<div class="panel">
  <div class="panel__head">
    <h3>${R.esc(m.subject || '(无主题)')}</h3>
    ${m.handled ? R.badge('ok', '已处理') : R.badge('warn', '未处理')}
    <span class="toolbar__spacer"></span>
    <span class="muted" style="font-size:12.5px">${R.fmtDate(m.created_at, true)}</span>
  </div>
  <div class="panel__body">
    <div class="row-inline" style="margin-bottom:12px">
      <span class="badge badge-brand">${R.esc(m.name)}</span>
      ${m.contact ? `<span class="muted" style="font-size:13px">${R.esc(m.contact)}</span>` : ''}
      ${m.ip ? `<span class="muted mono" style="font-size:12px">${R.esc(m.ip)}</span>` : ''}
    </div>
    <div class="detail-prose">${R.esc(m.body)}</div>
  </div>
  <div class="panel__foot">
    ${
      m.handled
        ? `<button class="btn btn-ghost btn-sm" type="button" data-act="msg" data-id="${m.id}" data-handled="0">标记为未处理</button>`
        : `<button class="btn btn-primary btn-sm" type="button" data-act="msg" data-id="${m.id}" data-handled="1">标记为已处理</button>`
    }
    <a class="btn btn-ghost btn-sm" href="mailto:${R.escAttr(m.contact)}">回复</a>
  </div>
</div>`
        )
        .join('')
    : `<div class="empty">${R.icon('mail', 32)}<p>还没有收到留言。</p></div>`
}
<script>
document.addEventListener('click', function(e){
  var b = e.target.closest('[data-act="msg"]');
  if (!b) return;
  window.praxApi('/api/messages/' + b.getAttribute('data-id'), {
    method:'PATCH', body:{ handled: Number(b.getAttribute('data-handled')) }
  }).then(function(){ window.praxToast('已更新','ok'); setTimeout(function(){location.reload();},500); })
    .catch(function(err){ window.praxToast(err.message,'err'); });
});
</script>`;

  sendPage(req, res, { pageTitle: '留言', pageSub: '来自前台联系表单的消息', body });
});

/* ================================================================ 操作日志 */

router.get('/admin/audit', auth.requireAuth, auth.requirePerm('audit'), (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = 60;
  const total = countOf('audit_logs');
  const list = all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?', size, (page - 1) * size);
  const pages = Math.max(1, Math.ceil(total / size));

  const body = `
<div class="page-head">
  <div class="muted" style="font-size:13px">共 ${total} 条记录 · 第 ${page} / ${pages} 页</div>
</div>
<div class="panel">
  <div class="panel__body">
    ${
      list.length
        ? list
            .map(
              (l) => `<div class="log-line">
      <span class="log-time">${R.fmtDate(l.created_at, true)}</span>
      <span class="log-user">${R.esc(l.username || '系统')}</span>
      <span class="log-act">${R.esc(l.action)}</span>
      <span class="log-detail">${R.esc(l.detail || '')}${
                l.target_type ? ` <span class="muted mono">[${R.esc(l.target_type)}#${R.esc(l.target_id)}]</span>` : ''
              }</span>
      ${l.ip ? `<span class="muted mono" style="font-size:11.5px;margin-left:auto">${R.esc(l.ip)}</span>` : ''}
    </div>`
            )
            .join('')
        : `<div class="empty">${R.icon('shield', 30)}<p>暂无操作记录。</p></div>`
    }
  </div>
  ${
    pages > 1
      ? `<div class="panel__foot">
    ${
      page > 1
        ? `<a class="btn btn-ghost btn-sm" href="/admin/audit?page=${page - 1}">上一页</a>`
        : ''
    }
    <span class="muted" style="font-size:13px">第 ${page} / ${pages} 页</span>
    ${
      page < pages
        ? `<a class="btn btn-ghost btn-sm" href="/admin/audit?page=${page + 1}">下一页</a>`
        : ''
    }
  </div>`
      : ''
  }
</div>`;

  sendPage(req, res, { pageTitle: '操作日志', pageSub: '所有后台写操作的审计记录', body });
});

/* ================================================================ 站点设置 */

const SETTING_GROUPS = [
  {
    title: '站点信息',
    icon: 'home',
    fields: [
      { name: 'site_name', label: '站点名称', type: 'text' },
      { name: 'site_name_en', label: '英文名', type: 'text' },
      { name: 'site_abbr', label: '简称', type: 'text' },
      { name: 'site_tagline', label: '一句话标语', type: 'text' },
      { name: 'site_description', label: '站点描述', type: 'textarea', span: 3 },
      { name: 'contact_email', label: '联系邮箱', type: 'text' },
      { name: 'footer_note', label: '页脚署名', type: 'text' },
    ],
  },
  {
    title: '子页面（可自定义名称）',
    icon: 'palette',
    desc: '子页面的名称与介绍完全可配置，改完即刻生效，无需改动代码。',
    fields: [
      { name: 'subpage_name', label: '子页面名称', type: 'text' },
      { name: 'subpage_name_en', label: '子页面英文名', type: 'text' },
      { name: 'subpage_tagline', label: '子页面副标题', type: 'text' },
      { name: 'subpage_intro', label: '子页面介绍', type: 'textarea', span: 3 },
    ],
  },
  {
    title: '首页展示开关',
    icon: 'eye',
    desc: '控制首页各个板块是否对外展示。',
    fields: [
      { name: 'show_projects', label: '展示项目板块', type: 'bool' },
      { name: 'show_showcase_strip', label: '展示工坊导流', type: 'bool' },
      { name: 'show_announcements', label: '展示公告板块', type: 'bool' },
      { name: 'show_friends', label: '展示友情链接', type: 'bool' },
      { name: 'show_oa_entry', label: '展示协同入口', type: 'bool' },
      { name: 'enable_contact_form', label: '开放留言表单', type: 'bool' },
    ],
  },
  {
    title: '品牌配色',
    icon: 'sparkle',
    desc: '默认取自官方标识；修改后会覆盖前台主题色。',
    fields: [
      { name: 'theme_primary', label: '主色', type: 'color' },
      { name: 'theme_accent', label: '强调色', type: 'color' },
      { name: 'theme_cream', label: '纸面色', type: 'color' },
    ],
  },
];

router.get('/admin/settings', auth.requireAuth, auth.requirePerm('settings'), (req, res) => {
  const s = getSettings();

  const groupsHtml = SETTING_GROUPS.map(
    (g) => `<div class="set-group">
  <div class="set-group__title">${R.icon(g.icon, 14)}${R.esc(g.title)}</div>
  ${g.desc ? `<p class="muted" style="font-size:13px;margin:-6px 0 14px">${R.esc(g.desc)}</p>` : ''}
  <div class="grid-3">
    ${g.fields
      .map((f) => {
        const val = s[f.name];
        const span = f.span || 1;
        const style = span > 1 ? ` style="grid-column:span ${span}"` : '';
        if (f.type === 'bool') {
          const on = val === true || val === 1 || val === '1' || val === 'true';
          return `<div class="field"${style}>
        <span class="label">${R.esc(f.label)}</span>
        <label class="switch">
          <input type="hidden" name="${R.escAttr(f.name)}" value="0">
          <input type="checkbox" name="${R.escAttr(f.name)}" value="1"${on ? ' checked' : ''}>
          <span class="switch__track"></span>
          <span>${on ? '已开启' : '已关闭'}</span>
        </label>
      </div>`;
        }
        if (f.type === 'textarea') {
          return `<div class="field"${style}>
        <label for="s_${f.name}">${R.esc(f.label)}</label>
        <textarea class="textarea" id="s_${f.name}" name="${R.escAttr(f.name)}">${R.esc(val || '')}</textarea>
      </div>`;
        }
        if (f.type === 'color') {
          return `<div class="field"${style}>
        <label for="s_${f.name}">${R.esc(f.label)}</label>
        <div class="color-row">
          <input type="color" name="${R.escAttr(f.name)}" value="${R.escAttr(val || '#C34C18')}"
                 oninput="this.nextElementSibling.value=this.value">
          <input class="input" value="${R.escAttr(val || '')}" oninput="this.previousElementSibling.value=this.value">
        </div>
      </div>`;
        }
        return `<div class="field"${style}>
      <label for="s_${f.name}">${R.esc(f.label)}</label>
      <input class="input" id="s_${f.name}" name="${R.escAttr(f.name)}" value="${R.escAttr(val || '')}">
    </div>`;
      })
      .join('')}
  </div>
</div>`
  ).join('');

  const body = `
<form data-ajax action="/api/settings" data-method="PATCH">
  <div class="panel">
    <div class="panel__head">
      <h3>站点设置</h3>
      <span class="toolbar__spacer"></span>
      <span class="muted" style="font-size:12.5px">保存后前台立即生效</span>
    </div>
    <div class="panel__body">${groupsHtml}</div>
    <div class="panel__foot">
      <button class="btn btn-primary" type="submit">${R.icon('check', 16)}保存设置</button>
      <a class="btn btn-ghost" href="/admin">返回工作台</a>
    </div>
  </div>
</form>

<div class="panel">
  <div class="panel__head"><h3>系统信息</h3></div>
  <div class="panel__body">
    <div class="grid-3">
      <div class="field"><span class="label">Node 版本</span><div class="mono">${R.esc(
        process.version
      )}</div></div>
      <div class="field"><span class="label">站点地址</span><div class="mono">${R.esc(
        (req.protocol || 'http') + '://' + (req.headers.host || '')
      )}</div></div>
      <div class="field"><span class="label">上传目录</span><div class="mono">${R.esc(
        // Windows 上 path.relative 会给出反斜杠，展示时统一成正斜杠
        (path.relative(ROOT_DIR, UP_DIR) || UP_DIR).replace(/\\/g, '/')
      )}</div></div>
    </div>
  </div>
</div>`;

  sendPage(req, res, { pageTitle: '站点设置', pageSub: '站点信息、子页面命名与首页开关', body });
});

/* ================================================================ 资源 CRUD API
 *
 * 同样必须在「固定 API 路径」之后挂载：
 *   /api/:resource/:id 与 /api/media/:id、/api/messages/:id 的形状完全相同，
 *   先注册的会吃掉后者。见文件末尾的 mountResourceApi()。
 */

function mountResourceApi() {
router.post('/api/:resource', auth.requireAuth, requireRes, (req, res) => {
  const resDef = req.resDef;
  if (!auth.hasPerm(req.user, resDef.perm)) {
    return res.status(403).json({ ok: false, error: '没有该操作权限' });
  }

  const body = req.body || {};
  const data = coerceBody(resDef, body, { isCreate: true });

  if (resDef.fields.some((f) => f.required && !String(data[f.name] || '').trim())) {
    const missing = resDef.fields.filter((f) => f.required && !String(data[f.name] || '').trim());
    return res.status(400).json({ ok: false, error: `请填写：${missing.map((f) => f.label).join('、')}` });
  }

  // slug 处理
  if (resDef.fields.some((f) => f.name === 'slug')) {
    data.slug = uniqueSlug(resDef.key, data.slug || data.title || data.name, null);
  }

  // 密码处理
  let passwordPlain = data.password_plain;
  delete data.password_plain;
  if (resDef.key === 'users') {
    if (!passwordPlain) {
      return res.status(400).json({ ok: false, error: '新建成员必须设置密码' });
    }
    data.password_hash = auth.hashPassword(passwordPlain);
  }

  const cols = Object.keys(data);
  if (!cols.length) return res.status(400).json({ ok: false, error: '没有可保存的内容' });

  const sql = `INSERT INTO ${resDef.key} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  let info;
  try {
    info = run(sql, ...cols.map((c) => data[c]));
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) {
      return res.status(400).json({ ok: false, error: '该账号或标识已存在，请换一个' });
    }
    throw e;
  }

  auth.logAudit(
    req,
    'create',
    resDef.key,
    info.lastInsertRowid,
    `新建${resDef.single}：${data.title || data.name || data.label || data.username || ''}`
  );
  res.json({ ok: true, message: `已创建${resDef.single}`, id: Number(info.lastInsertRowid) });
});

router.patch('/api/:resource/:id', auth.requireAuth, requireRes, (req, res) => {
  const resDef = req.resDef;
  if (!auth.hasPerm(req.user, resDef.perm)) {
    return res.status(403).json({ ok: false, error: '没有该操作权限' });
  }

  const id = Number(req.params.id);
  const existing = get(`SELECT * FROM ${resDef.key} WHERE id = ?`, id);
  if (!existing) return res.status(404).json({ ok: false, error: '记录不存在' });

  const data = coerceBody(resDef, req.body || {}, { isCreate: false });

  if (resDef.fields.some((f) => f.name === 'slug') && data.slug !== undefined) {
    data.slug = uniqueSlug(resDef.key, data.slug || data.title || existing.title, id);
  }

  if (resDef.key === 'users') {
    const plain = data.password_plain;
    delete data.password_plain;
    if (plain) data.password_hash = auth.hashPassword(plain);
    if (data.role && existing.role === 'admin' && data.role !== 'admin') {
      const admins = countOf('users', "role = 'admin' AND status = 'active'");
      if (admins <= 1) {
        return res.status(400).json({ ok: false, error: '至少要保留一名启用状态的超级管理员' });
      }
    }
    if (data.status === 'disabled' && existing.role === 'admin') {
      const admins = countOf('users', "role = 'admin' AND status = 'active'");
      if (admins <= 1) {
        return res.status(400).json({ ok: false, error: '至少要保留一名启用状态的超级管理员' });
      }
      auth.destroyUserSessions(id);
    }
  }

  const cols = Object.keys(data);
  if (!cols.length) return res.status(400).json({ ok: false, error: '没有可保存的内容' });

  const sql = `UPDATE ${resDef.key} SET ${cols.map((c) => `${c} = ?`).join(', ')}${
    resDef.fields.some((f) => f.name === 'updated_at') ? ", updated_at = datetime('now','localtime')" : ''
  } WHERE id = ?`;
  try {
    run(sql, ...cols.map((c) => data[c]), id);
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) {
      return res.status(400).json({ ok: false, error: '该账号或标识已存在' });
    }
    throw e;
  }

  auth.logAudit(
    req,
    'update',
    resDef.key,
    id,
    `更新${resDef.single}：${data.title || existing.title || data.name || existing.name || ''}（字段：${cols.join(
      ','
    )}）`
  );
  res.json({ ok: true, message: '已保存' });
});

router.delete('/api/:resource/:id', auth.requireAuth, requireRes, (req, res) => {
  const resDef = req.resDef;
  if (!auth.hasPerm(req.user, resDef.perm)) {
    return res.status(403).json({ ok: false, error: '没有该操作权限' });
  }
  const id = Number(req.params.id);
  const existing = get(`SELECT * FROM ${resDef.key} WHERE id = ?`, id);
  if (!existing) return res.status(404).json({ ok: false, error: '记录不存在' });

  // 不允许删除自己，避免把自己锁在门外
  if (resDef.key === 'users' && id === req.user.id) {
    return res.status(400).json({ ok: false, error: '不能删除当前登录的账号' });
  }
  if (resDef.key === 'users' && existing.role === 'admin') {
    const admins = countOf('users', "role = 'admin'");
    if (admins <= 1) {
      return res.status(400).json({ ok: false, error: '至少要保留一名超级管理员' });
    }
  }

  run(`DELETE FROM ${resDef.key} WHERE id = ?`, id);
  if (resDef.key === 'users') auth.destroyUserSessions(id);

  auth.logAudit(
    req,
    'delete',
    resDef.key,
    id,
    `删除${resDef.single}：${existing.title || existing.name || existing.label || existing.username || id}`
  );
  res.json({ ok: true, message: '已删除' });
});
}

/* ================================================================ 设置 API */

router.patch('/api/settings', auth.requireAuth, auth.requirePerm('settings'), (req, res) => {
  const body = req.body || {};
  const allowed = new Set();
  SETTING_GROUPS.forEach((g) => g.fields.forEach((f) => allowed.add(f.name)));

  // 布尔字段在白名单里，统一按 0/1 存
  const boolNames = new Set();
  SETTING_GROUPS.forEach((g) =>
    g.fields.forEach((f) => {
      if (f.type === 'bool') boolNames.add(f.name);
    })
  );

  const changed = [];
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.has(k)) continue;
    if (boolNames.has(k)) {
      setSetting(k, v === true || v === '1' || v === 1 || v === 'true' || v === 'on');
    } else {
      setSetting(k, String(v).slice(0, 4000));
    }
    changed.push(k);
  }

  auth.logAudit(req, 'update', 'settings', '', `更新站点设置（${changed.length} 项：${changed.join(',')}）`);
  res.json({ ok: true, message: '设置已保存' });
});

/* ================================================================ 媒体 API */

router.post('/api/media/upload', auth.requireAuth, auth.requirePerm('media'), (req, res) => {
  upload.array('files', 12)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message || '上传失败' });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, error: '没有收到文件' });

    const items = [];
    for (const f of files) {
      const url = '/uploads/' + f.filename;
      let width = 0;
      let height = 0;

      // 从文件头读取图片尺寸（PNG/JPEG/GIF/WebP），失败也不影响上传
      try {
        const dims = readImageSize(path.join(UP_DIR, f.filename), f.mimetype);
        width = dims.width;
        height = dims.height;
      } catch (_) {}

      const info = run(
        `INSERT INTO media (filename, original_name, url, mime, size, width, height, kind, uploaded_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        f.filename,
        f.originalname || '',
        url,
        f.mimetype || '',
        f.size || 0,
        width,
        height,
        'image',
        req.user.id
      );
      items.push({ id: Number(info.lastInsertRowid), url, name: f.originalname, width, height });
    }

    auth.logAudit(req, 'upload', 'media', '', `上传 ${items.length} 个文件：${items.map((i) => i.name).join(', ')}`);
    res.json({ ok: true, items });
  });
});

/** 极简图片尺寸读取（避免引入图像库） */
function readImageSize(file, mime) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(64);
    fs.readSync(fd, buf, 0, 64, 0);

    if (mime === 'image/png' && buf.toString('ascii', 1, 4) === 'PNG') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === 'image/gif') {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (mime === 'image/jpeg') {
      // 扫描 SOF 段
      const size = fs.fstatSync(fd).size;
      const data = Buffer.alloc(Math.min(size, 256 * 1024));
      fs.readSync(fd, data, 0, data.length, 0);
      let i = 2;
      while (i < data.length - 9) {
        if (data[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = data[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
        }
        i += 2 + data.readUInt16BE(i + 2);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return { width: 0, height: 0 };
}

router.delete('/api/media/:id', auth.requireAuth, auth.requirePerm('media'), (req, res) => {
  const id = Number(req.params.id);
  const m = get('SELECT * FROM media WHERE id = ?', id);
  if (!m) return res.status(404).json({ ok: false, error: '文件不存在' });

  // 只删自己 uploads 目录下的文件，且必须是纯文件名
  if (String(m.url).startsWith('/uploads/')) {
    const name = path.basename(String(m.url));
    const target = path.join(UP_DIR, name);
    if (target.startsWith(UP_DIR) && fs.existsSync(target)) {
      try {
        fs.unlinkSync(target);
      } catch (_) {}
    }
  }
  run('DELETE FROM media WHERE id = ?', id);
  auth.logAudit(req, 'delete', 'media', id, `删除媒体文件：${m.original_name || m.filename}`);
  res.json({ ok: true, message: '已删除' });
});

/* ================================================================ 留言状态 */

router.patch('/api/messages/:id', auth.requireAuth, auth.requirePerm('messages'), (req, res) => {
  const id = Number(req.params.id);
  const m = get('SELECT * FROM messages WHERE id = ?', id);
  if (!m) return res.status(404).json({ ok: false, error: '留言不存在' });
  const handled = req.body && (req.body.handled === 1 || req.body.handled === '1' || req.body.handled === true) ? 1 : 0;
  run('UPDATE messages SET handled = ? WHERE id = ?', handled, id);
  auth.logAudit(req, 'update', 'messages', id, `留言标记为${handled ? '已处理' : '未处理'}`);
  res.json({ ok: true, message: '已更新' });
});

/* ================================================================ 审批决策 */

router.patch('/api/approvals/:id/decision', auth.requireAuth, auth.requirePerm('oa'), (req, res) => {
  const id = Number(req.params.id);
  const a = get('SELECT * FROM approvals WHERE id = ?', id);
  if (!a) return res.status(404).json({ ok: false, error: '审批单不存在' });

  const status = String((req.body && req.body.status) || '');
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ ok: false, error: '无效的审批状态' });
  }
  const note = String((req.body && req.body.decision_note) || '').slice(0, 1000);

  run(
    `UPDATE approvals SET status = ?, decision_note = ?, approver_id = ?, decided_at = ${
      status === 'pending' ? 'NULL' : "datetime('now','localtime')"
    } WHERE id = ?`,
    status,
    note,
    req.user.id,
    id
  );
  auth.logAudit(
    req,
    'approve',
    'approvals',
    id,
    `审批「${a.title}」-> ${status === 'approved' ? '通过' : status === 'rejected' ? '驳回' : '待审批'}${
      note ? '：' + note : ''
    }`
  );
  res.json({ ok: true, message: '审批结果已保存' });
});

/* ================================================================ 任务状态快捷流转 */

router.patch('/api/tasks/:id/progress', auth.requireAuth, auth.requirePerm('oa'), (req, res) => {
  const id = Number(req.params.id);
  const t = get('SELECT * FROM tasks WHERE id = ?', id);
  if (!t) return res.status(404).json({ ok: false, error: '任务不存在' });

  const body = req.body || {};
  const status = body.status ? String(body.status) : null;
  let progress = body.progress === undefined ? null : Number(body.progress);

  if (progress !== null && Number.isFinite(progress)) {
    progress = Math.max(0, Math.min(100, Math.round(progress)));
  } else {
    progress = null;
  }

  if (status && !['todo', 'doing', 'review', 'done', 'archived'].includes(status)) {
    return res.status(400).json({ ok: false, error: '无效的任务状态' });
  }
  // 标记完成时自动补齐进度
  if (status === 'done' && progress === null) progress = 100;
  if (status === 'todo' && progress === null) progress = 0;

  run(
    `UPDATE tasks SET status = COALESCE(?, status), progress = COALESCE(?, progress),
       updated_at = datetime('now','localtime') WHERE id = ?`,
    status,
    progress,
    id
  );
  auth.logAudit(req, 'update', 'tasks', id, `任务「${t.title}」-> ${status || '进度更新'}`);
  res.json({ ok: true, message: '已更新' });
});

/* ================================================================ 自建页面
 *
 * 页面用专门的编辑器界面（实时预览 + 历史版本），所以不走通用资源表单。
 *
 * 路由顺序很重要：这些必须以 mountPageRoutes() 的形式在 mountResourceApi()
 * 与 mountResourceRoutes() **之前**注册。否则 /api/:resource 会先匹配到
 * /api/pages，把请求交给通用 CRUD —— 那样就会绕过 HTML 清洗与历史留档。
 */

const PE = require('../page-editor');
const contentMod = require('../content');

function mountPageRoutes() {

function pageCountOf() {
  return countOf('pages');
}

/** 取一个页面行，并把布尔列转好 */
function fetchPage(id) {
  const p = get('SELECT * FROM pages WHERE id = ?', id);
  if (!p) return null;
  return Object.assign({}, p, {
    visible: toBool(p.visible) ? 1 : 0,
    in_nav: toBool(p.in_nav) ? 1 : 0,
    show_header: toBool(p.show_header) ? 1 : 0,
    show_footer: toBool(p.show_footer) ? 1 : 0,
  });
}

/**
 * 校验并规整页面输入。
 * 注意 HTML 内容会经过清洗后再落库 —— 存进去的就是清洗后的版本，
 * 这样前台渲染与预览不会出现"存的是一套、显示的是另一套"的落差。
 */
function preparePageInput(body, { isCreate, existing }) {
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  // 这三个字段也必须遵守 PATCH 语义：
  // 缺省时沿用原值，否则一次"只改正文"的请求会把 HTML 页面悄悄变成 Markdown。
  const title = String((has('title') ? body.title : existing ? existing.title : '') || '').trim();
  const format = contentMod.normalizeFormat(
    has('format') ? body.format : existing ? existing.format : 'markdown'
  );
  const layoutRaw = String(
    (has('layout') ? body.layout : existing ? existing.layout : 'cream') || 'cream'
  );
  const layout = ['plain', 'portal', 'cream'].includes(layoutRaw) ? layoutRaw : 'cream';

  /**
   * slug 的取值规则（URL 稳定性很关键，改标题不应该悄悄换掉访问地址）：
   *   - 请求里**明确带了** slug 字段：用它的值；空字符串也尊重（表示"按标题重新生成"）
   *   - 请求里**没带** slug 字段：编辑时沿用 existing.slug；新建时按标题生成
   * 早期版本写成 `if (!slug) slug = title`，导致「只改标题」的请求会把
   * /p/old-slug 静默改名，已经发出去的链接全部 404。
   */
  let slugSource;
  let slugLocked;
  if (Object.prototype.hasOwnProperty.call(body, 'slug')) {
    slugSource = String(body.slug || '').trim();
    slugLocked = false;
  } else if (!isCreate && existing) {
    slugSource = existing.slug;
    slugLocked = true;
  } else {
    slugSource = '';
    slugLocked = false;
  }

  let slug = slugSource || title;
  slug = slug
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  const rawBody = String(body.body === undefined ? (existing ? existing.body : '') : body.body);

  /**
   * 其余字段同样遵守 PATCH 语义：请求里**没出现**的字段保持原值。
   * 早期版本对所有字段一律 `body.x || 0`，于是「只改正文」的请求会把
   * visible / show_header 全部刷成 0，页面就悄悄从站点上消失了。
   */
  const asBool = (v) => (v === '1' || v === 1 || v === true || v === 'true' || v === 'on' ? 1 : 0);

  /** 字段缺省时回退到 existing 的值（新建时回退到给定默认值） */
  const pick = (key, fallback) => {
    if (has(key)) return body[key];
    if (existing && existing[key] !== undefined && existing[key] !== null) return existing[key];
    return fallback;
  };

  return {
    title,
    slug,
    slugLocked,
    format,
    layout,
    summary: String(pick('summary', '') || '').trim().slice(0, 500),
    // 正文一律先渲染一次再存：Markdown 存原文（便于再次编辑），
    // 但 HTML 存**清洗后**的版本，避免把可执行内容留在库里。
    body: format === 'html' ? contentMod.sanitizeHtml(rawBody) : rawBody,
    cover: String(pick('cover', '') || '').trim(),
    in_nav: asBool(pick('in_nav', 0)),
    nav_label: String(pick('nav_label', '') || '').trim().slice(0, 60),
    visible: asBool(pick('visible', 1)),
    show_header: asBool(pick('show_header', 1)),
    show_footer: asBool(pick('show_footer', 1)),
    sort_order: Number.isFinite(Number(pick('sort_order', 0))) ? Number(pick('sort_order', 0)) : 0,
  };
}

/** slug 唯一化（复用通用工具） */
function pageSlug(base, excludeId) {
  return uniqueSlug('pages', base, excludeId);
}

/** 保存前留档 */
function snapshotPage(page, req, note) {
  run(
    `INSERT INTO page_revisions (page_id, title, format, body, note, user_id, username)
     VALUES (?,?,?,?,?,?,?)`,
    page.id,
    page.title || '',
    page.format || 'markdown',
    page.body || '',
    note || '',
    req.user ? req.user.id : null,
    req.user ? req.user.username : ''
  );
  // 每个页面只保留最近 30 个版本，避免无限膨胀
  const old = all(
    'SELECT id FROM page_revisions WHERE page_id = ? ORDER BY id DESC LIMIT -1 OFFSET 30',
    page.id
  );
  for (const r of old) run('DELETE FROM page_revisions WHERE id = ?', r.id);
}

/** 列表 */
router.get('/admin/pages', auth.requireAuth, auth.requirePerm('content'), (req, res) => {
  const q = String(req.query.q || '').trim();
  let sql = 'SELECT * FROM pages';
  const params = [];
  if (q) {
    sql += ' WHERE title LIKE ? OR slug LIKE ? OR summary LIKE ?';
    params.push('%' + q + '%', '%' + q + '%', '%' + q + '%');
  }
  sql += ' ORDER BY sort_order, id';

  const list = all(sql, ...params).map((p) =>
    Object.assign({}, p, {
      visible: toBool(p.visible),
      in_nav: toBool(p.in_nav),
    })
  );

  const canWrite = auth.hasPerm(req.user, 'content');

  const body = `
<div class="page-head">
  <div class="muted" style="font-size:13px">共 ${list.length} 个自建页面，访问路径形如 <span class="mono">/p/路径</span></div>
  <div class="page-head__act">
    ${
      canWrite
        ? `<a class="btn btn-primary btn-sm" href="/admin/pages/new">${R.icon('plus', 15)}新建页面</a>`
        : ''
    }
  </div>
</div>

<div class="toolbar">
  <div class="search-box">
    ${R.icon('search', 16)}
    <input class="input" id="tableSearch" placeholder="在当前列表中筛选…">
  </div>
  <span class="muted" style="font-size:12.5px">Markdown 更适合写文章；HTML 可以自由排版</span>
</div>

${PE.pageList(list)}
<div class="empty" id="tableNone" hidden>${R.icon('search', 30)}<p>没有匹配的页面。</p></div>`;

  sendPage(req, res, {
    pageTitle: '自建页面',
    pageSub: `内容管理 · 共 ${list.length} 个页面`,
    body,
  });
});

/** 新建 */
router.get('/admin/pages/new', auth.requireAuth, auth.requirePerm('content'), (req, res) => {
  const media = all('SELECT * FROM media ORDER BY id DESC LIMIT 40');
  const body = PE.pageEditor(null) + A.mediaPickerModal(media);
  sendPage(req, res, {
    pageTitle: '新建页面',
    pageSub: 'Markdown 或 HTML 都可以',
    body,
    scripts: ['/assets/js/page-editor.js'],
  });
});

/** 编辑 */
router.get('/admin/pages/:id', auth.requireAuth, auth.requirePerm('content'), (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next();
  const page = fetchPage(id);
  if (!page) return next();

  const media = all('SELECT * FROM media ORDER BY id DESC LIMIT 40');
  const body = PE.pageEditor(page) + A.mediaPickerModal(media);
  sendPage(req, res, {
    pageTitle: '编辑页面',
    pageSub: page.title,
    body,
    scripts: ['/assets/js/page-editor.js'],
  });
});

/** 创建 API */
router.post('/api/pages', auth.requireAuth, auth.requirePerm('content'), (req, res) => {
  const data = preparePageInput(req.body || {}, { isCreate: true, existing: null });
  if (!data.title) {
    return res.status(400).json({ ok: false, error: '请填写页面标题' });
  }
  delete data.slugLocked;
  data.slug = pageSlug(data.slug || data.title, null);

  const cols = Object.keys(data);
  const info = run(
    `INSERT INTO pages (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    ...cols.map((c) => data[c])
  );
  const id = Number(info.lastInsertRowid);
  const created = fetchPage(id);
  if (created) snapshotPage(created, req, '创建');

  auth.logAudit(req, 'create', 'pages', id, `新建页面：${data.title}（/p/${data.slug}，${data.format}）`);
  res.json({ ok: true, message: '页面已创建', id, slug: data.slug, url: '/p/' + data.slug });
});

/** 更新 API */
router.patch('/api/pages/:id', auth.requireAuth, auth.requirePerm('content'), (req, res) => {
  const id = Number(req.params.id);
  const existing = fetchPage(id);
  if (!existing) return res.status(404).json({ ok: false, error: '页面不存在' });

  const data = preparePageInput(req.body || {}, { isCreate: false, existing });
  if (!data.title) {
    return res.status(400).json({ ok: false, error: '请填写页面标题' });
  }
  const locked = !!data.slugLocked;
  delete data.slugLocked;
  // slugLocked 表示请求里没带 slug —— 沿用原地址，不因为改了标题就换 URL
  data.slug = locked && existing.slug ? existing.slug : pageSlug(data.slug || data.title, id);

  // 正文或标题真的变了才留档，避免重复保存刷出一堆空版本
  const changed =
    data.body !== existing.body || data.title !== existing.title || data.format !== existing.format;
  if (changed) snapshotPage(existing, req, '保存前自动留档');

  const cols = Object.keys(data);
  run(
    `UPDATE pages SET ${cols.map((c) => c + ' = ?').join(', ')},
       updated_at = datetime('now','localtime') WHERE id = ?`,
    ...cols.map((c) => data[c]),
    id
  );

  auth.logAudit(req, 'update', 'pages', id, `更新页面：${data.title}（/p/${data.slug}，${data.format}）`);
  res.json({ ok: true, message: '已保存', slug: data.slug, url: '/p/' + data.slug });
});

/** 预览 API：用与前台完全相同的渲染管线 */
router.post('/api/pages/preview', auth.requireAuth, auth.requirePerm('content'), (req, res) => {
  const body = String((req.body && req.body.body) || '');
  const format = contentMod.normalizeFormat(req.body && req.body.format);
  if (body.length > 512 * 1024) {
    return res.status(413).json({ ok: false, error: '内容过长，预览上限 512 KB' });
  }
  res.json({ ok: true, html: contentMod.renderBody(body, format), format });
});

/** 历史版本列表 */
router.get('/api/pages/:id/revisions', auth.requireAuth, auth.requirePerm('content'), (req, res) => {
  const id = Number(req.params.id);
  const page = get('SELECT id, title FROM pages WHERE id = ?', id);
  if (!page) return res.status(404).json({ ok: false, error: '页面不存在' });

  const list = all(
    `SELECT id, title, format, note, username, created_at, LENGTH(body) AS size
     FROM page_revisions WHERE page_id = ? ORDER BY id DESC LIMIT 30`,
    id
  );
  res.json({ ok: true, items: list });
});

/** 读取某个版本的内容 */
router.get('/api/pages/:id/revisions/:revId', auth.requireAuth, auth.requirePerm('content'), (req, res) => {
  const id = Number(req.params.id);
  const revId = Number(req.params.revId);
  const rev = get('SELECT * FROM page_revisions WHERE id = ? AND page_id = ?', revId, id);
  if (!rev) return res.status(404).json({ ok: false, error: '版本不存在' });
  res.json({ ok: true, revision: rev });
});

/** 回滚到某个版本（回滚前也会留档，所以可以再滚回来） */
router.post('/api/pages/:id/revisions/:revId/restore', auth.requireAuth, auth.requirePerm('content'), (req, res) => {
  const id = Number(req.params.id);
  const revId = Number(req.params.revId);
  const page = fetchPage(id);
  if (!page) return res.status(404).json({ ok: false, error: '页面不存在' });
  const rev = get('SELECT * FROM page_revisions WHERE id = ? AND page_id = ?', revId, id);
  if (!rev) return res.status(404).json({ ok: false, error: '版本不存在' });

  snapshotPage(page, req, `回滚到版本 #${revId} 之前`);

  run(
    `UPDATE pages SET title = ?, format = ?, body = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    rev.title || page.title,
    rev.format || page.format,
    rev.body || '',
    id
  );

  auth.logAudit(req, 'restore', 'pages', id, `回滚页面「${page.title}」到版本 #${revId}`);
  res.json({ ok: true, message: '已回滚到该版本' });
});

} // end mountPageRoutes()

/* ================================================================ 兜底 404 */

// 顺序要求：页面专用路由 -> 固定 API -> 通用资源。
// 每一步都不能颠倒，否则参数路由会抢先吃掉具体路径。
mountPageRoutes();
mountResourceApi();
mountResourceRoutes();

router.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: '接口不存在' });
  }
  res.status(404).send(
    R.layout({
      page: '404',
      title: '页面不存在',
      settings: getSettings(),
      user: req.user,
      body: `<main class="section" style="padding-top:180px;text-align:center">
  <div class="wrap-narrow">
    <div style="font-size:96px;font-weight:800;color:var(--prax-orange);line-height:1">404</div>
    <h1 style="margin:16px 0 12px">没有找到这个页面</h1>
    <p class="lead">它可能已被移动或删除。</p>
    <div class="hero__cta" style="justify-content:center;margin-top:24px">
      <a class="btn btn-primary" href="/">返回首页</a>
      <a class="btn btn-ghost" href="/admin">进入后台</a>
    </div>
  </div>
</main>`,
    })
  );
});

module.exports = router;
