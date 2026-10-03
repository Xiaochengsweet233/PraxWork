'use strict';
/**
 * 布局体检：用无头 Chrome 打开若干页面与视口宽度，
 * 检测横向溢出、元素越界、控制台报错。
 *
 * 用法：node tools/layout-check.js [baseUrl]
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const PORT = 9444;

const PAGES = [
  '/',
  '/atelier',
  '/admin/login',
  '/n/1',
  '/p/prax-portal',
  '/p/about',
  '/p/html-demo',
  '/p/editor-demo',
];
const WIDTHS = [360, 420, 768, 1024, 1440, 1920];

(async () => {
  if (!CHROME) {
    console.error('找不到 Chrome / Edge');
    process.exit(1);
  }

  const userDataDir = path.join(os.tmpdir(), 'prax-layout-' + Date.now());
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--hide-scrollbars',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + userDataDir,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  await new Promise((r) => setTimeout(r, 2600));

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];

  socket.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails.text || 'exception');
    }
  });

  await new Promise((r) => socket.addEventListener('open', r));

  function send(method, params) {
    const mid = ++id;
    return new Promise((resolve) => {
      pending.set(mid, resolve);
      socket.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
  }

  await send('Runtime.enable');
  await send('Page.enable');

  let problems = 0;

  for (const p of PAGES) {
    for (const w of WIDTHS) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: 900,
        deviceScaleFactor: 1,
        mobile: w < 700,
      });
      await send('Page.navigate', { url: BASE + p });
      await new Promise((r) => setTimeout(r, 1400));

      const res = await send('Runtime.evaluate', {
        expression: `(() => {
          const de = document.documentElement;
          const overflowX = de.scrollWidth - de.clientWidth;
          const bad = [];
          if (overflowX > 2) {
            const lim = de.clientWidth;
            document.querySelectorAll('body *').forEach(el => {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return;
              // 只看真正超出视口右边界的元素
              if (r.right > lim + 2) {
                const st = getComputedStyle(el);
                if (st.position === 'fixed') return;
                bad.push({
                  sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
                        ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : ''),
                  right: Math.round(r.right),
                  over: Math.round(r.right - lim)
                });
              }
            });
          }
          return JSON.stringify({
            overflowX,
            clientWidth: de.clientWidth,
            scrollWidth: de.scrollWidth,
            offenders: bad.sort((a,b)=>b.over-a.over).slice(0,5)
          });
        })()`,
        returnByValue: true,
      });

      const data = JSON.parse(res.result.value);
      if (data.overflowX > 2) {
        problems++;
        console.log(`\x1b[31m✗\x1b[0m ${p} @ ${w}px — 横向溢出 ${data.overflowX}px`);
        data.offenders.forEach((o) =>
          console.log(`     └ ${o.sel}  右边界=${o.right}  超出=${o.over}px`)
        );
      } else {
        console.log(`\x1b[32m✓\x1b[0m ${p} @ ${w}px`);
      }
    }
  }

  socket.close();
  chrome.kill();
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch (_) {}

  if (consoleErrors.length) {
    console.log('\n\x1b[33m控制台错误：\x1b[0m');
    [...new Set(consoleErrors)].slice(0, 20).forEach((e) => console.log('  - ' + e));
    problems++;
  } else {
    console.log('\n\x1b[32m✓\x1b[0m 无控制台错误');
  }

  console.log(`\n=== 布局体检：${problems} 个问题 ===\n`);
  process.exit(problems ? 1 : 0);
})().catch((e) => {
  console.error('布局体检失败：', e);
  process.exit(1);
});
