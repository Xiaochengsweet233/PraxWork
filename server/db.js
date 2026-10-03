'use strict';
/**
 * 数据层：SQLite（Node 内置 node:sqlite，无需任何原生编译依赖）
 *
 * node:sqlite 返回的对象是 null 原型，直接 JSON.stringify 是安全的，
 * 但访问不存在的列会得到 undefined，因此各路由统一用 row()/rows() 做规整。
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * 版本自检（部署到宝塔/容器前后最容易踩的坑）
 *
 * node:sqlite 的可用边界（据 Node 官方文档）：
 *   v22.5.0  新增，但**必须**加 --experimental-sqlite 才能 require
 *   v22.13.0 / v23.4.0  移出 flag，可以直接 require（仍标注 experimental）
 *   v24+     持续可用；v25.7.0 起转为 release candidate
 *
 * 所以「不带 flag 就能跑」的最低版本是 22.13.0。
 * 面板上如果装了 22.5~22.12 之间的版本，会报 ERR_UNKNOWN_BUILTIN_MODULE，
 * 报错信息很难懂，这里提前拦住并说清原因与解决办法。
 */
const NODE_MIN = [22, 13, 0];
function checkNodeVersion() {
  const cur = process.versions.node.split('.').map(Number);
  const tooOld =
    cur[0] < NODE_MIN[0] ||
    (cur[0] === NODE_MIN[0] &&
      (cur[1] < NODE_MIN[1] || (cur[1] === NODE_MIN[1] && cur[2] < NODE_MIN[2])));
  if (!tooOld) return;

  // 旧版本仍可通过显式 flag 使用，给出两条出路
  const hasFlag = process.execArgv.some((a) => a.includes('experimental-sqlite'));
  const canFlag = cur[0] === 22 && cur[1] >= 5;
  if (canFlag && hasFlag) return;

  console.error('');
  console.error('  ┌────────────────────────────────────────────────────────────┐');
  console.error('  │  启动失败：Node.js 版本过低                                │');
  console.error('  └────────────────────────────────────────────────────────────┘');
  console.error('');
  console.error(`  当前版本：v${process.versions.node}`);
  console.error(`  需要版本：v22.13.0 或更高（推荐 v24 LTS）`);
  console.error('');
  console.error('  原因：本项目使用 Node 内置的 node:sqlite，');
  console.error('        它从 v22.13.0 起才能免 --experimental-sqlite 标志直接使用。');
  console.error('');
  if (canFlag) {
    console.error('  临时办法：加标志启动');
    console.error('    node --experimental-sqlite server/index.js');
    console.error('');
  }
  console.error('  推荐做法：升级 Node.js');
  console.error('    宝塔面板 → 网站 → Node 项目 → 版本管理 → 安装 v24 LTS');
  console.error('');
  process.exit(1);
}
checkNodeVersion();

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('');
  console.error('  无法加载 node:sqlite 模块。');
  console.error(`  当前 Node 版本：v${process.versions.node}`);
  console.error('  请升级到 v22.13.0 以上（推荐 v24 LTS）。');
  console.error('');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.PRAX_DATA_DIR
  ? path.resolve(process.env.PRAX_DATA_DIR)
  : path.join(ROOT, 'data');
const DB_FILE = process.env.PRAX_DB_FILE
  ? path.resolve(process.env.PRAX_DB_FILE)
  : path.join(DATA_DIR, 'prax.sqlite');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

// ------------------------------------------------------------------ 表结构

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL DEFAULT '',
  email         TEXT    NOT NULL DEFAULT '',
  role          TEXT    NOT NULL DEFAULT 'member',
  title         TEXT    NOT NULL DEFAULT '',
  dept          TEXT    NOT NULL DEFAULT '',
  avatar        TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'active',
  last_login_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

/* 项目：后台可设置指向链接、封面、是否在主页展示 —— 门户核心能力 */
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  slug        TEXT    NOT NULL UNIQUE,
  subtitle    TEXT    NOT NULL DEFAULT '',
  summary     TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL DEFAULT '',
  cover       TEXT    NOT NULL DEFAULT '',
  link_url    TEXT    NOT NULL DEFAULT '',
  repo_url    TEXT    NOT NULL DEFAULT '',
  link_label  TEXT    NOT NULL DEFAULT '前往查看',
  category    TEXT    NOT NULL DEFAULT 'project',
  tags        TEXT    NOT NULL DEFAULT '[]',
  status      TEXT    NOT NULL DEFAULT 'active',
  featured    INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  visible     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_projects_visible ON projects(visible, sort_order);

/* 子页面内容：设计作业副产品 / 联动内容 */
CREATE TABLE IF NOT EXISTS showcases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  slug        TEXT    NOT NULL UNIQUE,
  subtitle    TEXT    NOT NULL DEFAULT '',
  summary     TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL DEFAULT '',
  cover       TEXT    NOT NULL DEFAULT '',
  link_url    TEXT    NOT NULL DEFAULT '',
  category    TEXT    NOT NULL DEFAULT 'side',
  tags        TEXT    NOT NULL DEFAULT '[]',
  year        TEXT    NOT NULL DEFAULT '',
  credit      TEXT    NOT NULL DEFAULT '',
  featured    INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  visible     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS friends (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  url         TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  icon        TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  visible     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS nav_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT    NOT NULL,
  href       TEXT    NOT NULL,
  target     TEXT    NOT NULL DEFAULT '_self',
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible    INTEGER NOT NULL DEFAULT 1
);

/* 自建页面：支持 Markdown 或 HTML，用于自行扩展站点 */
CREATE TABLE IF NOT EXISTS pages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  slug         TEXT    NOT NULL UNIQUE,
  format       TEXT    NOT NULL DEFAULT 'markdown',   -- markdown | html
  summary      TEXT    NOT NULL DEFAULT '',
  body         TEXT    NOT NULL DEFAULT '',
  cover        TEXT    NOT NULL DEFAULT '',
  layout       TEXT    NOT NULL DEFAULT 'cream',      -- cream | plain | portal（前台皮肤）
  show_header  INTEGER NOT NULL DEFAULT 1,
  show_footer  INTEGER NOT NULL DEFAULT 1,
  in_nav       INTEGER NOT NULL DEFAULT 0,            -- 是否自动出现在页头导航
  nav_label    TEXT    NOT NULL DEFAULT '',
  visible      INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pages_visible ON pages(visible, sort_order);

/* 页面历史版本：每次保存自动留档，可回滚 */
CREATE TABLE IF NOT EXISTS page_revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL DEFAULT '',
  format     TEXT    NOT NULL DEFAULT 'markdown',
  body       TEXT    NOT NULL DEFAULT '',
  note       TEXT    NOT NULL DEFAULT '',
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username   TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_rev_page ON page_revisions(page_id, id DESC);

CREATE TABLE IF NOT EXISTS announcements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  summary      TEXT    NOT NULL DEFAULT '',
  body         TEXT    NOT NULL DEFAULT '',
  cover        TEXT    NOT NULL DEFAULT '',
  tag          TEXT    NOT NULL DEFAULT '公告',
  pinned       INTEGER NOT NULL DEFAULT 0,
  visible      INTEGER NOT NULL DEFAULT 1,
  published_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

/* ---------------------------------------------------------------- OA 模块 */

CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  assignee_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  creator_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  priority     TEXT    NOT NULL DEFAULT 'normal',
  status       TEXT    NOT NULL DEFAULT 'todo',
  progress     INTEGER NOT NULL DEFAULT 0,
  due_date     TEXT    NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS task_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS approvals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  kind         TEXT    NOT NULL DEFAULT '通用',
  applicant_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approver_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount       REAL    NOT NULL DEFAULT 0,
  reason       TEXT    NOT NULL DEFAULT '',
  status       TEXT    NOT NULL DEFAULT 'pending',
  decision_note TEXT   NOT NULL DEFAULT '',
  decided_at   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT    NOT NULL,
  original_name TEXT    NOT NULL DEFAULT '',
  url           TEXT    NOT NULL,
  mime          TEXT    NOT NULL DEFAULT '',
  size          INTEGER NOT NULL DEFAULT 0,
  width         INTEGER NOT NULL DEFAULT 0,
  height        INTEGER NOT NULL DEFAULT 0,
  kind          TEXT    NOT NULL DEFAULT 'image',
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username    TEXT    NOT NULL DEFAULT '',
  action      TEXT    NOT NULL,
  target_type TEXT    NOT NULL DEFAULT '',
  target_id   TEXT    NOT NULL DEFAULT '',
  detail      TEXT    NOT NULL DEFAULT '',
  ip          TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  contact    TEXT    NOT NULL DEFAULT '',
  subject    TEXT    NOT NULL DEFAULT '',
  body       TEXT    NOT NULL DEFAULT '',
  handled    INTEGER NOT NULL DEFAULT 0,
  ip         TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

db.exec(SCHEMA);

// ------------------------------------------------------------------ 工具

/** 规整单行为普通对象（null 原型 -> 普通对象） */
function row(r) {
  return r ? Object.assign({}, r) : null;
}

/** 规整多行 */
function rows(list) {
  return (list || []).map((r) => Object.assign({}, r));
}

function all(sql, ...params) {
  return rows(db.prepare(sql).all(...params));
}

function get(sql, ...params) {
  return row(db.prepare(sql).get(...params));
}

function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

/** 安全解析 JSON 文本字段 */
function parseJSON(text, fallback) {
  if (text === null || text === undefined || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

/** 把对象里的 visible/featured/pinned/handled 等 0/1 字段转成布尔 */
function toBool(v) {
  return v === 1 || v === true || v === '1';
}

/** 记录审计日志 */
function audit({ userId, username, action, targetType, targetId, detail, ip }) {
  run(
    `INSERT INTO audit_logs (user_id, username, action, target_type, target_id, detail, ip)
     VALUES (?,?,?,?,?,?,?)`,
    userId || null,
    username || '',
    action,
    targetType || '',
    String(targetId === undefined || targetId === null ? '' : targetId),
    detail || '',
    ip || ''
  );
}

/** 读取全部设置，合并默认值 */
function getSettings() {
  const out = {};
  for (const r of all('SELECT key, value FROM settings')) {
    out[r.key] = parseJSON(r.value, r.value);
  }
  return out;
}

function setSetting(key, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?,?,datetime('now','localtime'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    text
  );
}

module.exports = {
  db,
  DB_FILE,
  DATA_DIR,
  ROOT,
  all,
  get,
  run,
  row,
  rows,
  parseJSON,
  toBool,
  audit,
  getSettings,
  setSetting,
};
