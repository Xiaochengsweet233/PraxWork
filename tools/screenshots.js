'use strict';
/**
 * 统一截图工具（CDP 驱动，结果可信）
 *
 * 为什么不用 --screenshot + --window-size：
 * 那种方式下 Chrome 的「布局视口」宽度与截图宽度不一致，
 * 会截出右侧被裁掉的假象，曾经导致对移动端布局的误判。
 * 这里改用 CDP 的 Emulation.setDeviceMetricsOverride，并禁用缓存，
 * 保证「测到的宽度」与「截到的画面」严格一致。
 *
 * 用法：
 *   node tools/screenshots.js              截取前台页面
 *   node tools/screenshots.js --admin      额外登录并截取后台页面
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

const BASE = process.env.PRAX_BASE || 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, '..', 'shots');
const PORT = 9466;

const PUBLIC_SHOTS = [
  { name: '01-portal-home', url: '/', w: 1440, h: 900 },
  { name: '02-portal-scroll', url: '/', w: 1440, h: 900, scrollTo: 900 },
  { name: '03-portal-mobile', url: '/', w: 420, h: 900 },
  { name: '04-atelier', url: '/atelier', w: 1440, h: 900 },
  { name: '05-atelier-scroll', url: '/atelier', w: 1440, h: 900, scrollTo: 780 },
  { name: '06-atelier-mobile', url: '/atelier', w: 420, h: 900 },
  { name: '07-atelier-mobile-scroll', url: '/atelier', w: 420, h: 900, scrollTo: 700 },
  { name: '08-login', url: '/admin/login', w: 1440, h: 900 },
  { name: '09-login-mobile', url: '/admin/login', w: 420, h: 900 },
  { name: '10-404', url: '/definitely-not-a-page', w: 1280, h: 800 },
  // 自建页面的前台效果
  { name: '11-custom-md', url: '/p/about', w: 1440, h: 1100 },
  { name: '12-custom-html', url: '/p/html-demo', w: 1440, h: 1000 },
  { name: '13-custom-editor-demo', url: '/p/editor-demo', w: 1440, h: 1200 },
];

const ADMIN_SHOTS = [
  { name: '20-admin-dash', url: '/admin', w: 1560, h: 1000 },
  { name: '21-admin-projects', url: '/admin/projects', w: 1560, h: 1000 },
  { name: '22-admin-project-edit', url: '/admin/projects/1', w: 1560, h: 1150 },
  { name: '23-admin-board', url: '/admin/board', w: 1560, h: 900 },
  { name: '24-admin-settings', url: '/admin/settings', w: 1560, h: 1250 },
  { name: '25-admin-media', url: '/admin/media', w: 1560, h: 950 },
  { name: '26-admin-audit', url: '/admin/audit', w: 1560, h: 900 },
  { name: '27-admin-tasks', url: '/admin/tasks', w: 1560, h: 950 },
  { name: '28-admin-users', url: '/admin/users', w: 1560, h: 900 },
  { name: '29-admin-mobile', url: '/admin', w: 420, h: 900 },
  // 页面编辑器
  { name: '30-pages-list', url: '/admin/pages', w: 1560, h: 900 },
  { name: '31-page-editor-md', url: '/admin/pages/2', w: 1680, h: 1200 },
  { name: '32-page-editor-html', url: '/admin/pages/3', w: 1680, h: 1200 },
  { name: '33-page-editor-new', url: '/admin/pages/new', w: 1680, h: 1100 },
  { name: '34-page-editor-mobile', url: '/admin/pages/2', w: 420, h: 900 },
];

async function loginCookie() {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const c = list.find((x) => x.startsWith('prax_session='));
  if (!c) throw new Error('登录失败：未取得会话 Cookie');
  return c.split(';')[0];
}

(async () => {
  if (!CHROME) {
    console.error('找不到 Chrome / Edge');
    process.exit(1);
  }
  const withAdmin = process.argv.includes('--admin');
  fs.mkdirSync(OUT, { recursive: true });

  let cookie = null;
  if (withAdmin) cookie = await loginCookie();

  const profile = path.join(os.tmpdir(), 'prax-shots-' + Date.now());
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--hide-scrollbars',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + profile,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  await new Promise((r) => setTimeout(r, 2600));

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  socket.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  });
  await new Promise((r) => socket.addEventListener('open', r));

  const send = (method, params) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      socket.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  if (cookie) {
    const [name, value] = cookie.split('=');
    await send('Network.setCookie', {
      name,
      value,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
    });
  }

  const shots = withAdmin ? PUBLIC_SHOTS.concat(ADMIN_SHOTS) : PUBLIC_SHOTS;

  for (const s of shots) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: s.w,
      height: s.h,
      deviceScaleFactor: 1,
      mobile: s.w < 700,
    });
    await send('Page.navigate', { url: BASE + s.url });
    await new Promise((r) => setTimeout(r, 1900));

    if (s.scrollTo) {
      await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${s.scrollTo})` });
      await new Promise((r) => setTimeout(r, 900));
    }

    // 顺带记录实际布局宽度，确认与截图一致
    const m = await send('Runtime.evaluate', {
      expression: `JSON.stringify({cw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth})`,
      returnByValue: true,
    });
    const meas = JSON.parse(m.result.value);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, s.name + '.png'), Buffer.from(shot.data, 'base64'));

    const flag = meas.sw > meas.cw + 2 ? ` \x1b[31m溢出 ${meas.sw - meas.cw}px\x1b[0m` : '';
    console.log(`  已截图 ${s.name.padEnd(26)} ${meas.cw}px${flag}`);
  }

  socket.close();
  chrome.kill();
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch (_) {}
  console.log('\n截图目录：', OUT);
  process.exit(0);
})().catch((e) => {
  console.error('截图失败：', e.message);
  process.exit(1);
});
