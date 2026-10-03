'use strict';
/**
 * 端到端自检：登录 -> 遍历后台页面 -> 校验内容 API 的增删改查与权限。
 * 用法：node tools/smoke.js [baseUrl]
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
    if (opts.form) {
      init.body = opts.body;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
  }
  const res = await fetch(BASE + path, init);
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookie) {
    if (c.startsWith('prax_session=')) cookie = c.split(';')[0];
  }
  const text = await res.text();
  let json = null;
  if ((res.headers.get('content-type') || '').includes('json')) {
    try {
      json = JSON.parse(text);
    } catch (_) {}
  }
  return { status: res.status, text, json, headers: res.headers };
}

async function main() {
  console.log(`\n=== Prax 端到端自检 @ ${BASE} ===\n`);

  /* ---------------------------------------------------------- 公开页面 */
  console.log('[公开页面]');
  for (const p of ['/', '/atelier', '/n/1', '/p/prax-portal']) {
    const r = await req(p);
    ok(`GET ${p} -> 200`, r.status === 200, 'got ' + r.status);
    ok(`  ${p} 无未转义脚本`, !/<script>alert/.test(r.text));
  }

  const home = await req('/');
  ok('首页含站点名', home.text.includes('橙曦澎湃'));
  ok('首页含 Gitee 友链', home.text.includes('gitee.com/RootpiXiaocheng'));
  ok('首页含 GitHub 友链', home.text.includes('github.com/Xiaochengsweet233'));
  ok('首页含工坊入口', home.text.includes('/atelier'));
  ok('首页含进站动效', home.text.includes('preloader'));

  const at = await req('/atelier');
  ok('工坊页含作品', at.text.includes('work__title'));
  ok('工坊页含筛选', at.text.includes('data-cat'));

  /* ---------------------------------------------------------- 鉴权 */
  console.log('\n[鉴权]');
  const badLogin = await req('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'wrong-password' },
  });
  ok('错误密码被拒', badLogin.status === 401, 'got ' + badLogin.status);

  // 未登录访问后台 API 应 401
  const noAuth = await req('/api/projects', { method: 'POST', body: { title: 'x' } });
  ok('未登录写接口被拒', noAuth.status === 401, 'got ' + noAuth.status);

  const login = await req('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' },
  });
  ok('管理员登录成功', login.status === 200 && login.json && login.json.ok, JSON.stringify(login.json));
  ok('已下发会话 Cookie', cookie.startsWith('prax_session='));

  /* ---------------------------------------------------------- 后台页面 */
  console.log('\n[后台页面]');
  const pages = [
    '/admin',
    '/admin/projects',
    '/admin/projects/new',
    '/admin/projects/1',
    '/admin/showcases',
    '/admin/showcases/new',
    '/admin/announcements',
    '/admin/friends',
    '/admin/nav_items',
    '/admin/tasks',
    '/admin/tasks/new',
    '/admin/board',
    '/admin/approvals',
    '/admin/approvals/1',
    '/admin/users',
    '/admin/users/new',
    '/admin/media',
    '/admin/messages',
    '/admin/audit',
    '/admin/settings',
  ];
  for (const p of pages) {
    const r = await req(p);
    ok(`GET ${p}`, r.status === 200, 'got ' + r.status);
  }

  const dash = await req('/admin');
  ok('工作台含统计', dash.text.includes('stat-grid'));
  ok('工作台含侧栏', dash.text.includes('admin-side'));

  const projPage = await req('/admin/projects');
  ok('项目列表含数据', projPage.text.includes('BetterStorage') || projPage.text.includes('Prax'));

  const setPage = await req('/admin/settings');
  ok('设置页含子页面命名', setPage.text.includes('subpage_name'));
  ok('设置页含首页开关', setPage.text.includes('show_projects'));
  ok('设置页含配色', setPage.text.includes('theme_primary'));

  /* ---------------------------------------------------------- 内容 CRUD */
  console.log('\n[内容 CRUD]');
  const created = await req('/api/projects', {
    method: 'POST',
    body: {
      title: '自检临时项目',
      slug: 'smoke-test-project',
      summary: '由自检脚本创建',
      link_url: 'https://example.com/smoke',
      category: 'project',
      tags: '自检, 临时',
      visible: 1,
      featured: 0,
      sort_order: 999,
    },
  });
  ok('创建项目', created.status === 200 && created.json && created.json.ok, JSON.stringify(created.json));
  const newId = created.json && created.json.id;

  if (newId) {
    const pageAfter = await req('/');
    ok('新项目出现在首页', pageAfter.text.includes('自检临时项目'));

    const patched = await req('/api/projects/' + newId, {
      method: 'PATCH',
      body: { visible: 0, title: '自检临时项目（已隐藏）' },
    });
    ok('更新项目', patched.status === 200 && patched.json.ok, JSON.stringify(patched.json));

    const pageHidden = await req('/');
    ok('隐藏后不出现在首页', !pageHidden.text.includes('自检临时项目'));

    const reShown = await req('/api/projects/' + newId, { method: 'PATCH', body: { visible: 1 } });
    ok('重新展示', reShown.json && reShown.json.ok);

    const badField = await req('/api/projects/' + newId, {
      method: 'PATCH',
      body: { evil_column: 'hack' },
    });
    ok('未知字段被忽略（不报错）', badField.status === 400 || (badField.json && badField.json.ok));

    const del = await req('/api/projects/' + newId, { method: 'DELETE' });
    ok('删除项目', del.status === 200 && del.json.ok, JSON.stringify(del.json));

    const gone = await req('/');
    ok('删除后首页不再出现', !gone.text.includes('自检临时项目'));
  }

  /* ---------------------------------------------------------- 设置生效 */
  console.log('\n[设置驱动前台]');
  const setRes = await req('/api/settings', {
    method: 'PATCH',
    body: { subpage_name: '自检工坊名' },
  });
  ok('保存设置', setRes.status === 200 && setRes.json.ok, JSON.stringify(setRes.json));

  const at2 = await req('/atelier');
  ok('子页面名称已生效', at2.text.includes('自检工坊名'), '未在前台看到新名称');

  const navHome = await req('/');
  ok('首页导航同步新名称', navHome.text.includes('自检工坊名'));

  await req('/api/settings', { method: 'PATCH', body: { subpage_name: '橙曦工坊' } });
  const at3 = await req('/atelier');
  ok('子页面名称可还原', at3.text.includes('橙曦工坊'));

  /* ------------------------------------------------ 首页开关必须真的生效 */
  // 这一组用来防止「后台有开关但前台不读」的装饰性设置回归
  console.log('\n[首页开关真的生效]');

  const toggles = [
    {
      key: 'show_projects',
      on: '浏览项目',
      off: '浏览项目',
      marker: (t) => t.includes('id="projects"'),
      label: '项目板块',
    },
    {
      key: 'show_showcase_strip',
      marker: (t) => t.includes('atelier-strip'),
      label: '工坊导流',
    },
    {
      key: 'show_announcements',
      marker: (t) => t.includes('id="news"'),
      label: '公告板块',
    },
    {
      key: 'show_friends',
      marker: (t) => t.includes('id="friends"'),
      label: '友情链接',
    },
    {
      key: 'show_oa_entry',
      // 精确匹配「关于」区块里的按钮：class="btn btn-ghost"（无 btn-sm），
      // 页头那个登录/后台入口带 btn-sm，因此不会误判。
      marker: (t) => t.includes('class="btn btn-ghost" href="/admin/login"'),
      label: '协同入口',
    },
    {
      key: 'enable_contact_form',
      marker: (t) => t.includes('id="contactForm"'),
      label: '留言表单',
    },
  ];

  for (const t of toggles) {
    // 先确认开启时确实存在
    await req('/api/settings', { method: 'PATCH', body: { [t.key]: 1 } });
    const onRes = await req('/');
    ok(`${t.label}：开启时前台可见`, t.marker(onRes.text));

    // 再确认关闭后确实消失
    await req('/api/settings', { method: 'PATCH', body: { [t.key]: 0 } });
    const offRes = await req('/');
    ok(`${t.label}：关闭时前台消失`, !t.marker(offRes.text));

    // 还原
    await req('/api/settings', { method: 'PATCH', body: { [t.key]: 1 } });
  }

  // 留言表单关闭时，接口也应拒绝提交
  await req('/api/settings', { method: 'PATCH', body: { enable_contact_form: 0 } });
  const contactBlocked = await req('/api/contact', {
    method: 'POST',
    body: { name: '自检', body: '关闭时不应写入' },
  });
  ok('留言关闭后接口拒绝提交', contactBlocked.status === 403, 'got ' + contactBlocked.status);
  await req('/api/settings', { method: 'PATCH', body: { enable_contact_form: 1 } });
  const contactOk = await req('/api/contact', {
    method: 'POST',
    body: { name: '自检', body: '开启后应写入' },
  });
  ok('留言开启后接口接受提交', contactOk.status === 200, 'got ' + contactOk.status);

  /* ---------------------------------------------------------- OA */
  console.log('\n[OA 协同]');
  const task = await req('/api/tasks', {
    method: 'POST',
    body: { title: '自检任务', description: '来自自检', status: 'todo', progress: 0, priority: 'high' },
  });
  ok('创建任务', task.status === 200 && task.json.ok, JSON.stringify(task.json));

  if (task.json && task.json.id) {
    const prog = await req(`/api/tasks/${task.json.id}/progress`, {
      method: 'PATCH',
      body: { status: 'done' },
    });
    ok('任务流转为已完成', prog.json && prog.json.ok, JSON.stringify(prog.json));

    const boardRes = await req('/admin/board');
    ok('看板可访问', boardRes.status === 200);

    ok('删除任务', (await req('/api/tasks/' + task.json.id, { method: 'DELETE' })).json.ok);
  }

  const decision = await req('/api/approvals/1/decision', {
    method: 'PATCH',
    body: { status: 'approved', decision_note: '自检通过' },
  });
  ok('审批决策', decision.status === 200 && decision.json.ok, JSON.stringify(decision.json));

  /* ---------------------------------------------------------- 审计日志 */
  console.log('\n[审计]');
  const audit = await req('/admin/audit');
  ok('日志页可访问', audit.status === 200);
  ok('日志记录了创建操作', audit.text.includes('create') || audit.text.includes('自检'));
  ok('日志记录了登录', audit.text.includes('login'));

  /* ---------------------------------------------------------- 权限 */
  console.log('\n[权限隔离]');
  const staffCookie = cookie;
  cookie = '';
  const staffLogin = await req('/api/auth/login', {
    method: 'POST',
    body: { username: 'rootpi', password: 'prax1234' },
  });
  ok('协作成员登录', staffLogin.json && staffLogin.json.ok);

  const staffUsers = await req('/admin/users');
  ok('协作成员不能进成员管理', staffUsers.status === 404 || staffUsers.status === 403, 'got ' + staffUsers.status);

  const staffWrite = await req('/api/projects', { method: 'POST', body: { title: 'x' } });
  ok('协作成员不能写内容', staffWrite.status === 403, 'got ' + staffWrite.status);

  const staffTasks = await req('/admin/tasks');
  ok('协作成员可进任务', staffTasks.status === 200, 'got ' + staffTasks.status);

  cookie = staffCookie;

  /* ---------------------------------------------------------- 上传 */
  console.log('\n[媒体上传]');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const fd = new FormData();
  fd.append('files', new Blob([png], { type: 'image/png' }), 'smoke.png');
  const upRes = await fetch(BASE + '/api/media/upload', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: fd,
  });
  const upJson = await upRes.json();
  ok('上传图片', upRes.status === 200 && upJson.ok, JSON.stringify(upJson));
  if (upJson.ok && upJson.items && upJson.items[0]) {
    const url = upJson.items[0].url;
    const fetchImg = await fetch(BASE + url);
    ok('上传的文件可访问', fetchImg.status === 200, 'got ' + fetchImg.status);
    const delMedia = await req('/api/media/' + upJson.items[0].id, { method: 'DELETE' });
    ok('删除媒体', delMedia.json && delMedia.json.ok);
  }

  /* ---------------------------------------------------------- 转义 */
  console.log('\n[XSS 防护]');
  const xss = await req('/api/projects', {
    method: 'POST',
    body: {
      title: '<img src=x onerror=alert(1)>自检XSS',
      slug: 'smoke-xss',
      summary: '"><script>alert(2)</script>',
      visible: 1,
    },
  });
  if (xss.json && xss.json.ok) {
    const pageX = await req('/');
    const escaped = pageX.text.includes('&lt;img src=x onerror=alert(1)&gt;');
    const rawTag = /onerror=alert\(1\)>/.test(pageX.text) && pageX.text.includes('<img src=x');
    ok('HTML 被转义（无原始标签）', escaped && !rawTag, escaped ? '' : '未找到转义后的文本');
    await req('/api/projects/' + xss.json.id, { method: 'DELETE' });
  } else {
    ok('XSS 用例创建（跳过）', false, JSON.stringify(xss.json));
  }

  /* ---------------------------------------------------------- 结果 */
  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('自检脚本异常：', e);
  process.exit(1);
});
