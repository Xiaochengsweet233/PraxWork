'use strict';
/**
 * 鉴权：scrypt 口令哈希 + 数据库会话令牌 + RBAC 权限
 * 仅使用 node:crypto，无外部加密依赖。
 */

const crypto = require('node:crypto');
const { all, get, run, audit } = require('./db');

const SESSION_COOKIE = 'prax_session';
const SESSION_DAYS = 7;
const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** 角色权限矩阵 */
const ROLES = {
  admin: {
    label: '超级管理员',
    rank: 100,
    perms: ['content', 'oa', 'users', 'media', 'settings', 'audit', 'messages'],
  },
  editor: {
    label: '内容编辑',
    rank: 60,
    perms: ['content', 'media', 'messages'],
  },
  staff: {
    label: '协作成员',
    rank: 40,
    perms: ['oa'],
  },
  member: {
    label: '普通成员',
    rank: 20,
    perms: [],
  },
};

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(plain), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(plain, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltHex, hashHex] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = crypto.scryptSync(String(plain), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(derived, expected);
  } catch (_) {
    return false;
  }
}

function hasPerm(user, perm) {
  if (!user) return false;
  const role = ROLES[user.role];
  if (!role) return false;
  return role.perms.includes(perm);
}

function rankOf(user) {
  if (!user) return 0;
  return (ROLES[user.role] || { rank: 0 }).rank;
}

/** 创建会话并返回令牌 */
function createSession(userId, { userAgent = '', ip = '' } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const expiresAt =
    `${expires.getFullYear()}-${pad(expires.getMonth() + 1)}-${pad(expires.getDate())} ` +
    `${pad(expires.getHours())}:${pad(expires.getMinutes())}:${pad(expires.getSeconds())}`;
  run(
    `INSERT INTO sessions (token, user_id, user_agent, ip, expires_at) VALUES (?,?,?,?,?)`,
    token,
    userId,
    String(userAgent).slice(0, 300),
    String(ip).slice(0, 80),
    expiresAt
  );
  return { token, expiresAt };
}

function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
}

function destroyUserSessions(userId) {
  run('DELETE FROM sessions WHERE user_id = ?', userId);
}

/** 清理过期会话 */
function purgeExpired() {
  run(`DELETE FROM sessions WHERE expires_at < datetime('now','localtime')`);
}

/** 依据令牌取用户 */
function userByToken(token) {
  if (!token) return null;
  const s = get(
    `SELECT s.token, s.expires_at, u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`,
    token
  );
  if (!s) return null;
  if (s.status !== 'active') return null;
  if (new Date(String(s.expires_at).replace(' ', 'T')) < new Date()) {
    destroySession(token);
    return null;
  }
  const { token: _t, expires_at: _e, password_hash: _p, ...user } = s;
  return user;
}

/** 解析 cookie */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch (_) {
        out[k] = v;
      }
    }
  }
  return out;
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

/** 挂载 req.user / res.locals.user */
function attachUser(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE] || req.headers['x-prax-token'] || '';
  req.sessionToken = token;
  req.user = userByToken(token) || null;
  res.locals.user = req.user;
  res.locals.can = (perm) => hasPerm(req.user, perm);
  next();
}

/** 把 'YYYY-MM-DD HH:MM:SS' 或 Date 统一成合法 Date；非法则回退到 7 天后 */
function normalizeExpiry(expiresAt) {
  let d = null;
  if (expiresAt instanceof Date) {
    d = expiresAt;
  } else if (typeof expiresAt === 'string' && expiresAt) {
    // SQLite 的 datetime 是 'YYYY-MM-DD HH:MM:SS'，需要用 T 分隔才能在所有环境解析
    d = new Date(expiresAt.replace(' ', 'T'));
    if (isNaN(d.getTime())) d = new Date(expiresAt);
  }
  if (!d || isNaN(d.getTime())) {
    d = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  }
  return d;
}

function setSessionCookie(res, token, expiresAt) {
  const exp = normalizeExpiry(expiresAt);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    expires: exp,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** 要求已登录 */
function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ ok: false, error: '请先登录' });
    }
    return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

/** 要求指定权限 */
function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: '请先登录' });
    }
    if (!hasPerm(req.user, perm)) {
      return res.status(403).json({ ok: false, error: '没有该操作权限' });
    }
    next();
  };
}

/** 要求管理员 */
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: '请先登录' });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '需要超级管理员权限' });
  }
  next();
}

function logAudit(req, action, targetType, targetId, detail) {
  audit({
    userId: req.user ? req.user.id : null,
    username: req.user ? req.user.username : '',
    action,
    targetType,
    targetId,
    detail,
    ip: clientIp(req),
  });
}

module.exports = {
  ROLES,
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  hasPerm,
  rankOf,
  createSession,
  destroySession,
  destroyUserSessions,
  purgeExpired,
  userByToken,
  parseCookies,
  clientIp,
  attachUser,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requirePerm,
  requireAdmin,
  logAudit,
};
