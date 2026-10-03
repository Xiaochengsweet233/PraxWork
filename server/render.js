'use strict';
/**
 * 极简模板层：不做复杂模板引擎，只做「HTML 片段 + 布局壳」的拼接。
 * 好处是零构建、零依赖，改一处即刻生效。
 */

const { ROLES } = require('./auth');

/** HTML 转义 —— 所有用户内容输出前必须经过它 */
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 属性值转义（用于 href/src，额外拦截 javascript: 等危险协议） */
function escAttr(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (/^\s*(javascript|data|vbscript):/i.test(s)) return '#';
  return esc(s);
}

/** 把纯文本转成安全的 HTML 段落（支持空行分段与单换行） */
function nl2p(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  return t
    .split(/\n{2,}/)
    .map((block) => `<p>${esc(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** 取摘要，超出长度截断 */
function truncate(text, n = 90) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if ([...t].length <= n) return t;
  return [...t].slice(0, n).join('') + '…';
}

function fmtDate(v, withTime = false) {
  if (!v) return '';
  const s = String(v).replace(' ', 'T');
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}` : base;
}

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

/** 相对时间，用于后台列表 */
function timeAgo(v) {
  if (!v) return '';
  const d = new Date(String(v).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(v);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return fmtDate(v);
}

/** 内联 SVG 图标集（描边风格，统一 1.8 线宽） */
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  box: 'M12 3 4 7v10l8 4 8-4V7zM4 7l8 4 8-4M12 11v10',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a3 3 0 0 1 0 6M18 7a6 6 0 0 1 0 10',
  link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
  users: 'M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 20v-1.5a4 4 0 0 0-3-3.87M16.5 3.9a3.5 3.5 0 0 1 0 6.8',
  check: 'M20 6 9 17l-5-5',
  clipboard: 'M9 4h6v3H9zM8 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H16',
  bolt: 'M13 3 5 13h5l-1 8 8-10h-5z',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M9 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-2.72 1.13V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.4 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 3 13.9H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.4l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 10.1 3V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.72 1.13l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 21 10.1h.1a2 2 0 1 1 0 4H21a1.6 1.6 0 0 0-1.6 1.5z',
  shield: 'M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z',
  logout: 'M15 17l5-5-5-5M20 12H9M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  file: 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9zM13 3v6h6',
  plus: 'M12 5v14M5 12h14',
  pencil: 'M4 20h4l10-10-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  palette:
    'M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-1.5a2 2 0 0 0-1.4 3.4A1.9 1.9 0 0 1 12 21zM7.5 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2M11 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2M15.5 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2',
  chevronDown: 'M6 9l6 6 6-6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM7.5 7h.01M7.5 17h.01',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0',
};

function icon(name, size = 20, cls = '') {
  const d = ICONS[name] || ICONS.sparkle;
  return (
    `<svg class="ico ${esc(cls)}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true">${d
      .split('M')
      .filter(Boolean)
      .map((seg) => `<path d="M${seg}"/>`)
      .join('')}</svg>`
  );
}

/** 角色中文名 */
function roleLabel(role) {
  return (ROLES[role] && ROLES[role].label) || role;
}

/** 状态中文名与配色（项目/任务/审批共用） */
const STATUS_MAP = {
  active: ['正常', 'ok'],
  hidden: ['隐藏', 'muted'],
  todo: ['待开始', 'muted'],
  doing: ['进行中', 'info'],
  review: ['待审核', 'warn'],
  done: ['已完成', 'ok'],
  archived: ['已归档', 'muted'],
  pending: ['待审批', 'warn'],
  approved: ['已通过', 'ok'],
  rejected: ['已驳回', 'danger'],
  active_user: ['正常', 'ok'],
  disabled: ['已停用', 'danger'],
  low: ['低', 'muted'],
  normal: ['普通', 'info'],
  high: ['高', 'warn'],
  urgent: ['紧急', 'danger'],
};

function badge(key, text) {
  const m = STATUS_MAP[key] || [key, 'muted'];
  return `<span class="badge badge-${m[1]}">${esc(text || m[0])}</span>`;
}

function statusBadge(key) {
  return badge(key);
}

/**
 * 站点布局壳。
 * opts: { title, description, page, body, bodyClass, user, settings, ogImage, noPreload }
 */
function layout(opts) {
  const s = opts.settings || {};
  const user = opts.user || null;
  const siteName = s.site_name || '橙曦澎湃';
  const siteEn = s.site_name_en || 'Project Rootpi & Xiaocheng';
  const abbr = s.site_abbr || 'Prax';
  const title = opts.title ? `${opts.title} · ${siteName}` : `${siteName} · ${siteEn}`;
  const desc = opts.description || s.site_description || '';
  const og = opts.ogImage || '/assets/img/og-cover.jpg';

  return `<!DOCTYPE html>
<html lang="zh-CN" data-page="${escAttr(opts.page || '')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${escAttr(desc)}">
<meta name="theme-color" content="${escAttr(s.theme_primary || '#C34C18')}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(desc)}">
<meta property="og:image" content="${escAttr(og)}">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="/assets/brand/logo-icon-192.png">
<link rel="apple-touch-icon" href="/assets/brand/logo-icon-180.png">
<link rel="stylesheet" href="/assets/css/base.css">
${(opts.styles || []).map((h) => `<link rel="stylesheet" href="${escAttr(h)}">`).join('\n')}
<script>
  // 提前写入主题令牌，避免 CSS 与后台配置不一致导致的闪烁
  window.__PRAX__ = {
    theme: {
      primary: ${JSON.stringify(s.theme_primary || '#C34C18')},
      accent: ${JSON.stringify(s.theme_accent || '#F2B603')},
      cream: ${JSON.stringify(s.theme_cream || '#F6F5EF')}
    },
    user: ${JSON.stringify(user ? { id: user.id, name: user.display_name || user.username, role: user.role } : null)}
  };
</script>
</head>
<body class="${escAttr(opts.bodyClass || '')}">
${opts.noPreload ? '' : preloader(abbr)}
<a class="skip-link" href="#main">跳到主要内容</a>
${opts.body || ''}
<div class="toast-host" id="toastHost" aria-live="polite"></div>
<script src="/assets/js/app.js" defer></script>
${(opts.scripts || []).map((h) => `<script src="${escAttr(h)}" defer></script>`).join('\n')}
</body>
</html>`;
}

/** 进站加载动效：品牌标识 + 进度条，挂载后淡出 */
function preloader(abbr) {
  return `<div class="preloader" id="preloader" role="status" aria-label="正在进入站点">
  <div class="preloader__inner">
    <div class="preloader__mark">
      <img src="/assets/brand/logo-mark.png" alt="" width="132" height="132">
      <span class="preloader__pulse"></span>
    </div>
    <div class="preloader__title">${esc(abbr)}</div>
    <div class="preloader__bar"><i id="preloaderBar"></i></div>
    <div class="preloader__hint">正在进入站点</div>
  </div>
</div>`;
}

/** 前台页头 */
function siteHeader({ settings, user, navItems = [], active = '' }) {
  const s = settings || {};
  const links = navItems
    .filter((n) => n.visible)
    .map((n) => {
      const isActive = active && n.href === active;
      const target = n.target === '_blank' ? ' target="_blank" rel="noopener"' : '';
      const external = /^https?:/i.test(n.href);
      return `<a class="nav__link${isActive ? ' is-active' : ''}" href="${escAttr(n.href)}"${target}>${esc(
        n.label
      )}${external ? icon('external', 13, 'nav__ext') : ''}</a>`;
    })
    .join('');

  const userArea = user
    ? `<a class="btn btn-ghost btn-sm" href="/admin">${icon('grid', 16)}<span>协同后台</span></a>`
    : `<a class="btn btn-ghost btn-sm" href="/admin/login">${icon('shield', 16)}<span>登录</span></a>`;

  return `<header class="site-header" id="siteHeader">
  <div class="wrap site-header__in">
    <a class="brand" href="/" aria-label="${escAttr(s.site_name || '橙曦澎湃')} 首页">
      <img class="brand__mark" src="/assets/brand/logo-mark.png" alt="" width="42" height="42">
      <span class="brand__text">
        <b>${esc(s.site_name || '橙曦澎湃')}</b>
        <i>${esc(s.site_abbr || 'Prax')} · ${esc(s.site_name_en || '')}</i>
      </span>
    </a>
    <nav class="nav" id="siteNav" aria-label="主导航">${links}</nav>
    <div class="site-header__act">
      ${userArea}
      <button class="nav-toggle" id="navToggle" aria-label="打开导航" aria-expanded="false">${icon(
        'menu',
        20
      )}</button>
    </div>
  </div>
</header>`;
}

/** 前台页脚 */
function siteFooter({ settings, navItems = [], friends = [], subpage }) {
  const s = settings || {};
  const links = navItems
    .filter((n) => n.visible)
    .map((n) => `<a href="${escAttr(n.href)}">${esc(n.label)}</a>`)
    .join('');
  const fr = (friends || [])
    .filter((f) => f.visible)
    .map(
      (f) =>
        `<a class="foot__friend" href="${escAttr(f.url)}" target="_blank" rel="noopener">` +
        `${icon('link', 14)}<span>${esc(f.name)}</span></a>`
    )
    .join('');

  return `<footer class="site-footer">
  <div class="wrap foot">
    <div class="foot__brand">
      <img src="/assets/brand/logo-lockup.png" alt="${escAttr(s.site_name || '橙曦澎湃')}" height="82">
      <p>${esc(s.footer_note || '')}</p>
    </div>
    <div class="foot__col">
      <h4>导航</h4>
      <div class="foot__links">${links}</div>
    </div>
    <div class="foot__col">
      <h4>友情链接</h4>
      <div class="foot__links">${fr || '<span class="muted">—</span>'}</div>
    </div>
    <div class="foot__col">
      <h4>联系</h4>
      <div class="foot__links">
        <a href="mailto:${escAttr(s.contact_email || '')}">${icon('mail', 14)}<span>${esc(
    s.contact_email || '—'
  )}</span></a>
      </div>
    </div>
  </div>
  <div class="wrap foot__base">
    <span>© ${new Date().getFullYear()} ${esc(s.site_name || '橙曦澎湃')} · ${esc(
    s.site_name_en || ''
  )}</span>
    <span class="foot__meta">${esc(s.subpage_name || '')} · Powered by Prax</span>
  </div>
</footer>`;
}

module.exports = {
  esc,
  escAttr,
  nl2p,
  truncate,
  fmtDate,
  fmtBytes,
  timeAgo,
  icon,
  roleLabel,
  badge,
  statusBadge,
  STATUS_MAP,
  layout,
  preloader,
  siteHeader,
  siteFooter,
};
