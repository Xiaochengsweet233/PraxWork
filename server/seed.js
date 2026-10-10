'use strict';
/**
 * 种子数据：仅在库为空时写入，可重复执行（幂等）。
 *
 * 子页面名称刻意做成配置项（setting: subpage_name / subpage_name_en），
 * 后台「站点设置」里可随时改名，无需改代码。
 */

const { db, all, get, run, setSetting, parseJSON } = require('./db');
const { hashPassword } = require('./auth');

const IMG = '/assets/img';
const COVER = (n) => `${IMG}/cover-${n}.jpg`;

function isEmpty(table) {
  const r = get(`SELECT COUNT(*) AS c FROM ${table}`);
  return !r || Number(r.c) === 0;
}

function seedSettings() {
  const defaults = {
    site_name: '橙曦澎湃',
    site_name_en: 'Project Rootpi & Xiaocheng',
    site_abbr: 'Prax',
    site_tagline: '把想法做成能用的东西',
    site_description:
      '橙曦澎湃（Project Rootpi & Xiaocheng，简称 Prax）—— 一个专注于插件开发、工具链建设与设计实践的小型创作组织。',
    contact_email: 'contact@example.com',
    footer_note: '橙曦澎湃 · Project Rootpi & Xiaocheng',

    // 子页面（可随时改名，无需改代码）
    subpage_name: '橙曦工坊',
    subpage_name_en: 'Prax Atelier',
    subpage_tagline: '设计作业的副产品与联动内容',
    subpage_intro:
      '这里收录日常设计作业延伸出来的副产品、实验性尝试，以及与主线项目彼此联动的内容。它们未必都成熟，但都在认真做。',

    // 外观
    theme_primary: '#C34C18',
    theme_accent: '#F2B603',
    theme_cream: '#F6F5EF',

    // 首页开关
    show_projects: true,
    show_showcase_strip: true,
    show_announcements: true,
    show_friends: true,
    show_oa_entry: true,
    enable_contact_form: true,

    // 登录页默认管理员提示：可在「站点设置」中永久关闭
    show_login_hint: true,
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (!get('SELECT key FROM settings WHERE key = ?', k)) setSetting(k, v);
  }
}

function seedUsers() {
  if (!isEmpty('users')) return;
  // 允许用环境变量覆盖初始管理员口令（容器部署时避免用默认弱口令）
  const adminPwd = process.env.PRAX_ADMIN_PASSWORD || 'admin123';
  const display = process.env.PRAX_ADMIN_NAME || '站点管理员';
  run(
    `INSERT INTO users (username, password_hash, display_name, role, title, dept, email)
     VALUES (?,?,?,?,?,?,?)`,
    'admin',
    hashPassword(adminPwd),
    display,
    'admin',
    '负责人',
    '',
    'admin@example.com'
  );
  console.log('  · 已创建默认管理员账号（admin）');
  if (process.env.PRAX_ADMIN_PASSWORD) {
    console.log('  · 管理员口令取自 PRAX_ADMIN_PASSWORD 环境变量');
  } else {
    console.log('  · 管理员初始口令为默认值，请登录后立即修改');
  }
}

function seedNav() {
  // 精简策略：不再预置任何演示导航。站点上线后由管理员在「内容管理 → 导航菜单」自行添加。
  return;
}

function seedProjects() {
  // 精简策略：不再预置演示项目。站点上线后由管理员在「内容管理 → 项目」自行创建。
  return;
}

function seedShowcases() {
  // 精简策略：不再预置演示工坊内容。
  return;
}

function seedFriends() {
  // 精简策略：不再预置友情链接。
  return;
}

function seedAnnouncements() {
  // 精简策略：不再预置演示公告。
  return;
}

function seedOA() {
  // 精简策略：不再预置演示任务与审批。
  return;
}

function seedPages() {
  // 精简策略：不再预置演示自建页面。站点上线后由管理员在「内容管理 → 自建页面」自行创建。
  return;
}

function seed() {
  console.log('正在初始化数据…');
  seedSettings();
  seedUsers();
  seedNav();
  seedProjects();
  seedShowcases();
  seedFriends();
  seedAnnouncements();
  seedPages();
  seedOA();
  console.log('数据初始化完成。');
}

if (require.main === module) {
  seed();
  const counts = [
    'users',
    'projects',
    'showcases',
    'pages',
    'friends',
    'announcements',
    'tasks',
    'approvals',
  ];
  for (const t of counts) {
    const r = get(`SELECT COUNT(*) AS c FROM ${t}`);
    console.log(`  ${t.padEnd(14)} ${r ? r.c : 0}`);
  }
}

module.exports = { seed, seedSettings };
