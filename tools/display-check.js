'use strict';
/**
 * 系统性检查：所有「看起来像卡片」的元素里，
 * 有没有哪一类是 inline 显示但有背景色/边框的 —— 那会导致背景只画成一条窄带。
 *
 * 用法：node tools/display-check.js
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://127.0.0.1:3000';
const PORT = 9499;

const PAGES = [
  '/',
  '/atelier',
  '/admin',
  '/admin/board',
  '/admin/projects',
  '/admin/settings',
  '/admin/media',
  '/admin/pages',
  '/admin/pages/2',
  '/p/about',
  '/p/html-demo',
];

/** 轮询等待 Chrome 调试端口就绪 */
async function waitForTargets(attempts) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      if (list.some((t) => t.type === 'page')) return list;
    } catch (_) {
      /* 还没起来，继续等 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('等待 Chrome 调试端口超时');
}

(async () => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const cookie = r.headers.getSetCookie().find((x) => x.startsWith('prax_session=')).split(';')[0];

  const profile = path.join(os.tmpdir(), 'prax-disp-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: 'ignore' });
  await new Promise((x) => setTimeout(x, 1500));

  // Chrome 首次用新 profile 启动较慢，轮询等待调试端口就绪
  const list = await waitForTargets(20);

  const page = list.find((t) => t.type === 'page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  await new Promise((x) => socket.addEventListener('open', x));
  const send = (method, params) =>
    new Promise((res) => { const mid = ++id; pending.set(mid, res); socket.send(JSON.stringify({ id: mid, method, params: params || {} })); });

  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const [n, v] = cookie.split('=');
  await send('Network.setCookie', { name: n, value: v, domain: '127.0.0.1', path: '/', httpOnly: true });

  let problems = 0;

  for (const p of PAGES) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: BASE + p });
    await new Promise((x) => setTimeout(x, 1500));

    const res = await send('Runtime.evaluate', {
      expression: `(() => {
        const bad = [];
        document.querySelectorAll('a, button, span, div, li, article').forEach(el => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (r.width < 40 || r.height < 30) return;
          const hasVisual = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
                            cs.backgroundImage !== 'none' ||
                            parseFloat(cs.borderTopWidth) > 0 ||
                            parseFloat(cs.borderLeftWidth) > 0;
          if (!hasVisual) return;
          // 文字渐变（background-clip:text）是刻意的效果，不是布局问题
          const clip = cs.webkitBackgroundClip || cs.backgroundClip;
          if (clip === 'text') return;
          // inline（且非 inline-block/flex/grid）会让背景只覆盖行盒
          if (cs.display === 'inline') {
            const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/)[0] : '';
            bad.push({
              tag: el.tagName.toLowerCase() + (cls ? '.' + cls : ''),
              size: Math.round(r.width) + 'x' + Math.round(r.height),
              text: (el.textContent || '').trim().slice(0, 16)
            });
          }
        });
        // 去重
        const seen = new Set(); const uniq = [];
        bad.forEach(b => { const k = b.tag; if (!seen.has(k)) { seen.add(k); uniq.push(b); } });
        return JSON.stringify(uniq);
      })()`,
      returnByValue: true,
    });

    const arr = JSON.parse(res.result.value);
    if (arr.length) {
      problems += arr.length;
      console.log(`\x1b[31m✗\x1b[0m ${p}`);
      arr.forEach((b) => console.log(`     ${b.tag}  ${b.size}  "${b.text}"`));
    } else {
      console.log(`\x1b[32m✓\x1b[0m ${p}`);
    }
  }

  socket.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n=== display 体检：${problems} 个可疑元素 ===\n`);
  process.exit(problems ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
