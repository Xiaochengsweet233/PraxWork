'use strict';
/**
 * 自建页面功能自检
 * 覆盖：创建/编辑/删除、两种格式的渲染与清洗、导航联动、历史版本与回滚、权限
 *
 * 用法：node tools/pages-test.js [baseUrl]
 */

const BASE = process.argv[2] || 'http://127.0.0.1:3000';

let cookie = '';
let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(name + (extra ? ' — ' + extra : ''));
    console.log(`  \x1b[31m✗\x1b[0m ${name}${extra ? ' — ' + extra : ''}`);
  }
}

async function req(path, opts = {}) {
  const init = {
    method: opts.method || 'GET',
    headers: Object.assign({ Accept: 'application/json' }, opts.headers || {}),
    redirect: 'manual',
  };
  if (cookie) init.headers.Cookie = cookie;
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(BASE + path, init);
  for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
    if (c.startsWith('prax_session=')) cookie = c.split(';')[0];
  }
  const text = await res.text();
  let json = null;
  if ((res.headers.get('content-type') || '').includes('json')) {
    try {
      json = JSON.parse(text);
    } catch (_) {}
  }
  return { status: res.status, text, json };
}

async function main() {
  console.log(`\n=== 自建页面自检 @ ${BASE} ===\n`);

  /* ---------------------------------------------------- 登录 */
  console.log('[准备]');
  const login = await req('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' },
  });
  ok('管理员登录', login.json && login.json.ok);

  const adminCookie = cookie;

  /* ---------------------------------------------------- 种子页面 */
  console.log('\n[内置演示页面]');
  const about = await req('/p/about');
  ok('Markdown 页可访问', about.status === 200);
  ok('  标题已渲染', about.text.includes('<h1>关于橙曦澎湃</h1>'));
  ok('  表格已渲染', about.text.includes('<table>'));
  ok('  列表已渲染', about.text.includes('<li>'));
  ok('  引用已渲染', about.text.includes('<blockquote>'));
  ok('  页头存在（默认显示）', about.text.includes('site-header'));

  const hd = await req('/p/html-demo');
  ok('HTML 页可访问', hd.status === 200);
  ok('  内联样式保留', hd.text.includes('border-radius:16px'));
  ok('  details 保留', hd.text.includes('<details>'));
  ok('  网格布局保留', hd.text.includes('display:grid'));

  /* ---------------------------------------------------- 创建 */
  console.log('\n[创建：Markdown]');
  const mdBody = '# 测试标题\n\n**加粗**与*斜体*，还有 `代码`。\n\n- 甲\n- 乙\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
  const created = await req('/api/pages', {
    method: 'POST',
    body: {
      title: '自检 Markdown 页',
      slug: 'smoke-md',
      format: 'markdown',
      layout: 'cream',
      summary: '自检用',
      body: mdBody,
      visible: '1',
      in_nav: '0',
      show_header: '1',
      show_footer: '1',
    },
  });
  ok('创建成功', created.status === 200 && created.json.ok, JSON.stringify(created.json));
  const mdId = created.json && created.json.id;

  if (mdId) {
    const page = await req('/p/smoke-md');
    ok('新页面可访问', page.status === 200);
    ok('  标题渲染', page.text.includes('<h1>测试标题</h1>'));
    ok('  加粗渲染', page.text.includes('<strong>加粗</strong>'));
    ok('  斜体渲染', page.text.includes('<em>斜体</em>'));
    ok('  行内代码渲染', page.text.includes('<code>代码</code>'));
    ok('  列表渲染', page.text.includes('<li>'));
    ok('  表格渲染', page.text.includes('<td>1</td>'));

    /* ------------------------------------------------ 编辑 */
    console.log('\n[编辑]');
    const upd = await req('/api/pages/' + mdId, {
      method: 'PATCH',
      body: { title: '自检 Markdown 页（改）', body: '# 改后的标题\n' },
    });
    ok('更新成功', upd.status === 200 && upd.json.ok, JSON.stringify(upd.json));

    const page2 = await req('/p/smoke-md');
    ok('  改动已生效', page2.text.includes('改后的标题'));
    ok('  旧内容已消失', !page2.text.includes('测试标题'));

    /* ------------------------------------------------ 导航联动 */
    console.log('\n[导航联动]');
    const home1 = await req('/');
    ok('未加入导航时不出现', !home1.text.includes('/p/smoke-md'));

    await req('/api/pages/' + mdId, {
      method: 'PATCH',
      body: { in_nav: '1', nav_label: '自检页面' },
    });
    const home2 = await req('/');
    ok('加入导航后出现在页头', home2.text.includes('/p/smoke-md'));
    ok('  使用了自定义导航文字', home2.text.includes('自检页面'));

    await req('/api/pages/' + mdId, { method: 'PATCH', body: { in_nav: '0' } });
    const home3 = await req('/');
    ok('取消导航后消失', !home3.text.includes('/p/smoke-md'));

    /* ------------------------------------------------ 隐藏 */
    console.log('\n[可见性]');
    await req('/api/pages/' + mdId, { method: 'PATCH', body: { visible: '0' } });
    ok('隐藏后前台 404', (await req('/p/smoke-md')).status === 404);
    await req('/api/pages/' + mdId, { method: 'PATCH', body: { visible: '1' } });
    ok('恢复后前台可访问', (await req('/p/smoke-md')).status === 200);

    /* ------------------------------------------------ 历史版本 */
    console.log('\n[历史版本]');
    const revs = await req('/api/pages/' + mdId + '/revisions');
    ok('版本列表可读', revs.status === 200 && revs.json.ok);
    ok('  已有历史版本', revs.json.items && revs.json.items.length > 0, '共 ' + (revs.json.items || []).length);

    if (revs.json.items && revs.json.items.length) {
      const firstRev = revs.json.items[revs.json.items.length - 1];
      const rev = await req('/api/pages/' + mdId + '/revisions/' + firstRev.id);
      ok('单个版本可读', rev.status === 200 && rev.json.ok);
      ok('  版本含正文', typeof rev.json.revision.body === 'string');

      const restore = await req('/api/pages/' + mdId + '/revisions/' + firstRev.id + '/restore', {
        method: 'POST',
      });
      ok('回滚成功', restore.status === 200 && restore.json.ok, JSON.stringify(restore.json));

      const afterRestore = await req('/p/smoke-md');
      ok('  回滚后内容恢复', afterRestore.text.includes('测试标题'));
    }

    /* ------------------------------------------------ 预览接口 */
    console.log('\n[预览接口]');
    const pv = await req('/api/pages/preview', {
      method: 'POST',
      body: { body: '## 小标题\n\n- x', format: 'markdown' },
    });
    ok('Markdown 预览', pv.json && pv.json.html.includes('<h2>小标题</h2>'));

    const pvHtml = await req('/api/pages/preview', {
      method: 'POST',
      body: { body: '<div style="color:red">红</div><script>bad()</script>', format: 'html' },
    });
    ok('HTML 预览保留样式', pvHtml.json && pvHtml.json.html.includes('color:red'));
    ok('HTML 预览清除脚本', pvHtml.json && !pvHtml.json.html.includes('<script'));

    /* ------------------------------------------------ 删除 */
    console.log('\n[删除]');
    const del = await req('/api/pages/' + mdId, { method: 'DELETE' });
    ok('删除成功', del.status === 200 && del.json.ok, JSON.stringify(del.json));
    ok('  前台已 404', (await req('/p/smoke-md')).status === 404);
    ok('  后台列表不再出现', !(await req('/admin/pages')).text.includes('smoke-md'));
  }

  /* ---------------------------------------------------- 安全性 */
  console.log('\n[安全性：HTML 格式]');
  const xss = await req('/api/pages', {
    method: 'POST',
    body: {
      title: '自检 XSS 页',
      slug: 'smoke-xss',
      format: 'html',
      body:
        '<p style="color:green">正常内容</p>' +
        '<script>alert(1)</script>' +
        '<img src=x onerror="alert(2)">' +
        '<a href="javascript:alert(3)">点我</a>' +
        '<iframe src="//evil.com"></iframe>',
      visible: '1',
    },
  });
  if (xss.json && xss.json.ok) {
    const xid = xss.json.id;
    const xpage = await req('/p/smoke-xss');
    ok('页面可访问', xpage.status === 200);
    ok('  正常内容保留', xpage.text.includes('正常内容'));
    ok('  内联样式保留', xpage.text.includes('color:green'));
    // 页面自带的 app.js 与布局里的主题令牌脚本是正常的，
    // 这里只确认注入内容没有留下任何可执行代码。
    ok('  注入的 script 已清除', !xpage.text.includes('alert(1)'));
    ok('  没有注入的可执行内联脚本', !/alert\s*\(\s*2\s*\)/.test(xpage.text));
    ok('  onerror 已清除', !xpage.text.includes('onerror=alert'));
    ok('  javascript: 已清除', !xpage.text.includes('javascript:alert'));
    ok('  iframe 已清除', !xpage.text.includes('<iframe'));

    await req('/api/pages/' + xid, { method: 'DELETE' });
  } else {
    ok('XSS 用例创建', false, JSON.stringify(xss.json));
  }

  console.log('\n[安全性：Markdown 里的原始 HTML]');
  const mdXss = await req('/api/pages', {
    method: 'POST',
    body: {
      title: '自检 MD 注入页',
      slug: 'smoke-md-xss',
      format: 'markdown',
      body: '<script>alert("md")</script>\n\n正常段落',
      visible: '1',
    },
  });
  if (mdXss.json && mdXss.json.ok) {
    const mpage = await req('/p/smoke-md-xss');
    ok('Markdown 页的 script 被转义', !mpage.text.includes('<script>alert("md")'));
    ok('  显示为文字', mpage.text.includes('&lt;script&gt;'));
    ok('  正常段落仍在', mpage.text.includes('正常段落'));
    await req('/api/pages/' + mdXss.json.id, { method: 'DELETE' });
  }

  /* ---------------------------------------------------- 权限 */
  console.log('\n[权限]');
  const savedAdmin = cookie;
  cookie = '';
  await req('/api/auth/login', { method: 'POST', body: { username: 'rootpi', password: 'prax1234' } });
  ok('协作成员不能创建页面', (await req('/api/pages', { method: 'POST', body: { title: 'x', body: 'y' } })).status === 403);
  // requirePerm 对缺失权限返回 403（与其它内容模块一致），这里跟随同一约定
  ok('协作成员不能访问页面编辑器', (await req('/admin/pages')).status === 403);
  ok('协作成员不能预览', (await req('/api/pages/preview', { method: 'POST', body: { body: 'x' } })).status === 403);
  cookie = savedAdmin;

  /* ---------------------------------------------------- 路由不冲突 */
  console.log('\n[与项目路由共存]');
  const proj = await req('/p/prax-portal');
  ok('项目详情页仍正常', proj.status === 200);
  ok('  是项目而不是页面', proj.text.includes('Portal & OA Platform') || proj.text.includes('项目') );

  /* ---------------------------------------------------- 结果 */
  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('自检异常：', e);
  process.exit(1);
});
