'use strict';
/**
 * 后台界面层：侧栏外壳 + 由「资源定义」驱动的通用列表 / 表单渲染。
 *
 * 这样每个内容模块（项目、工坊作品、友链、公告、导航、任务、审批…）
 * 只需声明字段，列表与表单自动生成，新增模块成本很低。
 */

const R = require('./render');
const { ROLES } = require('./auth');

/* ---------------------------------------------------------------- 资源定义 */
/*
 field = {
   name, label, type, hint, required, placeholder,
   options: [{value,label}] | 'projects' | 'users' | 'roles',
   span: 1|2|3,      // 在表单栅格中占几列
   listShow: true,   // 是否出现在列表
   readonly: true,
 }
 type: text | textarea | number | select | bool | image | tags | date | password | color | static
*/

const CATEGORY_PROJECT = [
  { value: 'platform', label: '平台' },
  { value: 'plugin', label: '插件' },
  { value: 'design', label: '设计' },
  { value: 'tool', label: '工具' },
  { value: 'project', label: '项目' },
];

const CATEGORY_SHOWCASE = [
  { value: 'side', label: '设计副产品' },
  { value: 'linked', label: '联动内容' },
  { value: 'experiment', label: '实验尝试' },
];

const TASK_STATUS = [
  { value: 'todo', label: '待开始' },
  { value: 'doing', label: '进行中' },
  { value: 'review', label: '待审核' },
  { value: 'done', label: '已完成' },
  { value: 'archived', label: '已归档' },
];

const TASK_PRIORITY = [
  { value: 'low', label: '低' },
  { value: 'normal', label: '普通' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' },
];

const APPROVAL_STATUS = [
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已驳回' },
];

const RESOURCES = {
  projects: {
    key: 'projects',
    title: '项目',
    single: '项目',
    icon: 'box',
    perm: 'content',
    permLabel: '内容管理',
    orderBy: 'sort_order, id',
    searchCols: ['title', 'summary', 'subtitle'],
    fields: [
      { name: 'title', label: '项目名称', type: 'text', required: true, span: 2, listShow: true },
      { name: 'slug', label: '标识（URL）', type: 'text', hint: '留空自动生成；用于 /p/标识', span: 2 },
      { name: 'subtitle', label: '副标题', type: 'text', span: 2, placeholder: '英文名或一句话定位' },
      { name: 'summary', label: '简介', type: 'textarea', span: 3, hint: '展示在卡片上，建议 80 字以内' },
      { name: 'body', label: '详情正文', type: 'textarea', span: 3, hint: '空行分段' },
      { name: 'cover', label: '封面图', type: 'image', span: 3 },
      { name: 'link_url', label: '指向链接', type: 'text', span: 2, hint: '前台点击卡片跳转的位置；可填站内路径或外部网址' },
      { name: 'link_label', label: '按钮文字', type: 'text', span: 1, placeholder: '前往查看' },
      { name: 'repo_url', label: '仓库链接', type: 'text', span: 2 },
      {
        name: 'category',
        label: '分类',
        type: 'select',
        options: CATEGORY_PROJECT,
        span: 1,
        listShow: true,
      },
      { name: 'tags', label: '标签', type: 'tags', span: 3, hint: '用逗号分隔，例如：Minecraft, 插件' },
      { name: 'featured', label: '精选', type: 'bool', span: 1, hint: '首页优先展示' },
      { name: 'visible', label: '首页展示', type: 'bool', span: 1, hint: '关闭后前台不可见，也不出现在列表中' },
      { name: 'sort_order', label: '排序', type: 'number', span: 1, hint: '数字越小越靠前' },
    ],
  },

  showcases: {
    key: 'showcases',
    title: '工坊内容',
    single: '工坊内容',
    icon: 'palette',
    perm: 'content',
    permLabel: '内容管理',
    orderBy: 'sort_order, id',
    searchCols: ['title', 'summary', 'subtitle'],
    fields: [
      { name: 'title', label: '标题', type: 'text', required: true, span: 2, listShow: true },
      { name: 'slug', label: '标识（URL）', type: 'text', span: 2 },
      { name: 'subtitle', label: '副标题', type: 'text', span: 2, placeholder: '英文名' },
      { name: 'summary', label: '简介', type: 'textarea', span: 3 },
      { name: 'body', label: '详情正文', type: 'textarea', span: 3 },
      { name: 'cover', label: '封面图', type: 'image', span: 3 },
      { name: 'link_url', label: '指向链接', type: 'text', span: 2 },
      { name: 'year', label: '年份', type: 'text', span: 1 },
      { name: 'credit', label: '归属说明', type: 'text', span: 1, placeholder: '设计作业副产品 / 与门户联动' },
      { name: 'category', label: '类型', type: 'select', options: CATEGORY_SHOWCASE, span: 1, listShow: true },
      { name: 'tags', label: '标签', type: 'tags', span: 1 },
      { name: 'featured', label: '精选', type: 'bool', span: 1 },
      { name: 'visible', label: '展示', type: 'bool', span: 1 },
      { name: 'sort_order', label: '排序', type: 'number', span: 1 },
    ],
  },

  announcements: {
    key: 'announcements',
    title: '公告',
    single: '公告',
    icon: 'megaphone',
    perm: 'content',
    permLabel: '内容管理',
    orderBy: 'pinned DESC, published_at DESC, id DESC',
    searchCols: ['title', 'summary'],
    fields: [
      { name: 'title', label: '标题', type: 'text', required: true, span: 3, listShow: true },
      { name: 'summary', label: '摘要', type: 'textarea', span: 3, hint: '列表与首页展示用' },
      { name: 'body', label: '正文', type: 'textarea', span: 3 },
      { name: 'cover', label: '配图', type: 'image', span: 3 },
      { name: 'tag', label: '标签', type: 'text', span: 1, placeholder: '公告 / 更新 / 设计' },
      { name: 'pinned', label: '置顶', type: 'bool', span: 1 },
      { name: 'visible', label: '展示', type: 'bool', span: 1 },
    ],
  },

  friends: {
    key: 'friends',
    title: '友情链接',
    single: '友情链接',
    icon: 'link',
    perm: 'content',
    permLabel: '内容管理',
    orderBy: 'sort_order, id',
    searchCols: ['name', 'url', 'description'],
    fields: [
      { name: 'name', label: '名称', type: 'text', required: true, span: 2, listShow: true },
      { name: 'url', label: '链接', type: 'text', required: true, span: 3, listShow: true },
      { name: 'description', label: '说明', type: 'text', span: 2 },
      { name: 'icon', label: '图标', type: 'image', span: 3, hint: '可留空，前台会用名称首字母生成' },
      { name: 'sort_order', label: '排序', type: 'number', span: 1 },
      { name: 'visible', label: '展示', type: 'bool', span: 1 },
    ],
  },

  pages: {
    key: 'pages',
    title: '自建页面',
    single: '页面',
    icon: 'file',
    perm: 'content',
    permLabel: '内容管理',
    orderBy: 'sort_order, id',
    searchCols: ['title', 'slug', 'summary'],
    // 页面正文编辑体验特殊（需要编辑器 + 预览），所以列表与表单都在
    // routes/admin.js 里单独渲染；这里保留字段定义用于保存时的白名单过滤。
    customList: true,
    customForm: true,
    fields: [
      { name: 'title', label: '页面标题', type: 'text', required: true, span: 2, listShow: true },
      { name: 'slug', label: '访问路径', type: 'text', span: 2, listShow: true },
      {
        name: 'format',
        label: '内容格式',
        type: 'select',
        options: [
          { value: 'markdown', label: 'Markdown' },
          { value: 'html', label: 'HTML' },
        ],
        span: 1,
        listShow: true,
      },
      {
        name: 'layout',
        label: '页面皮肤',
        type: 'select',
        options: [
          { value: 'cream', label: '米白（默认）' },
          { value: 'plain', label: '纯净（无页头页脚）' },
          { value: 'portal', label: '深橙（同门户）' },
        ],
        span: 1,
      },
      { name: 'summary', label: '摘要', type: 'textarea', span: 3, hint: '列表与搜索用' },
      { name: 'body', label: '页面正文', type: 'textarea', span: 3, hint: '由页面编辑器写入' },
      { name: 'cover', label: '题图', type: 'image', span: 3 },
      { name: 'in_nav', label: '加入导航', type: 'bool', span: 1, hint: '自动出现在页头导航' },
      { name: 'nav_label', label: '导航文字', type: 'text', span: 1, hint: '留空则用标题' },
      { name: 'visible', label: '对外可见', type: 'bool', span: 1 },
      { name: 'show_header', label: '显示页头', type: 'bool', span: 1 },
      { name: 'show_footer', label: '显示页脚', type: 'bool', span: 1 },
      { name: 'sort_order', label: '排序', type: 'number', span: 1 },
    ],
  },

  nav_items: {
    key: 'nav_items',
    title: '导航菜单',
    single: '导航项',
    icon: 'list',
    perm: 'content',
    permLabel: '内容管理',
    orderBy: 'sort_order, id',
    searchCols: ['label', 'href'],
    fields: [
      { name: 'label', label: '名称', type: 'text', required: true, span: 2, listShow: true },
      { name: 'href', label: '链接', type: 'text', required: true, span: 2, listShow: true },
      {
        name: 'target',
        label: '打开方式',
        type: 'select',
        options: [
          { value: '_self', label: '当前窗口' },
          { value: '_blank', label: '新窗口' },
        ],
        span: 1,
      },
      { name: 'sort_order', label: '排序', type: 'number', span: 1 },
      { name: 'visible', label: '展示', type: 'bool', span: 1 },
    ],
  },

  tasks: {
    key: 'tasks',
    title: '任务',
    single: '任务',
    icon: 'clipboard',
    perm: 'oa',
    permLabel: '协同办公',
    orderBy:
      "CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 WHEN 'review' THEN 2 WHEN 'done' THEN 3 ELSE 4 END, priority DESC, id DESC",
    searchCols: ['title', 'description'],
    fields: [
      { name: 'title', label: '任务标题', type: 'text', required: true, span: 3, listShow: true },
      { name: 'description', label: '描述', type: 'textarea', span: 3 },
      { name: 'project_id', label: '关联项目', type: 'select', options: 'projects', span: 1, listShow: true },
      { name: 'assignee_id', label: '负责人', type: 'select', options: 'users', span: 1, listShow: true },
      { name: 'priority', label: '优先级', type: 'select', options: TASK_PRIORITY, span: 1, listShow: true },
      { name: 'status', label: '状态', type: 'select', options: TASK_STATUS, span: 1, listShow: true },
      { name: 'progress', label: '进度（%）', type: 'number', span: 1, listShow: true },
      { name: 'due_date', label: '截止日期', type: 'date', span: 1 },
      { name: 'sort_order', label: '排序', type: 'number', span: 1 },
    ],
  },

  approvals: {
    key: 'approvals',
    title: '审批',
    single: '审批单',
    icon: 'check',
    perm: 'oa',
    permLabel: '协同办公',
    orderBy: "CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC",
    searchCols: ['title', 'reason', 'kind'],
    fields: [
      { name: 'title', label: '事项', type: 'text', required: true, span: 3, listShow: true },
      {
        name: 'kind',
        label: '类型',
        type: 'select',
        options: [
          { value: '通用', label: '通用' },
          { value: '采购', label: '采购' },
          { value: '报销', label: '报销' },
          { value: '服务器', label: '服务器' },
          { value: '资产', label: '资产' },
          { value: '请假', label: '请假' },
        ],
        span: 1,
        listShow: true,
      },
      { name: 'applicant_id', label: '申请人', type: 'select', options: 'users', span: 1 },
      { name: 'approver_id', label: '审批人', type: 'select', options: 'users', span: 1, listShow: true },
      { name: 'amount', label: '金额', type: 'number', span: 1, listShow: true },
      { name: 'reason', label: '事由', type: 'textarea', span: 3 },
      { name: 'status', label: '状态', type: 'select', options: APPROVAL_STATUS, span: 1, listShow: true },
      { name: 'decision_note', label: '审批意见', type: 'textarea', span: 2 },
    ],
  },

  users: {
    key: 'users',
    title: '成员',
    single: '成员',
    icon: 'users',
    perm: 'users',
    permLabel: '成员与权限',
    orderBy: "CASE role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END, id",
    searchCols: ['username', 'display_name', 'email', 'dept'],
    fields: [
      { name: 'username', label: '登录账号', type: 'text', required: true, span: 1, listShow: true, readonlyOnEdit: true },
      { name: 'display_name', label: '显示名称', type: 'text', span: 1, listShow: true },
      { name: 'password', label: '登录密码', type: 'password', span: 1, hint: '编辑时留空表示不修改' },
      { name: 'role', label: '角色', type: 'select', options: 'roles', span: 1, listShow: true },
      { name: 'title', label: '职务', type: 'text', span: 1 },
      { name: 'dept', label: '所属组', type: 'text', span: 1, listShow: true },
      { name: 'email', label: '邮箱', type: 'text', span: 1, listShow: true },
      {
        name: 'status',
        label: '状态',
        type: 'select',
        options: [
          { value: 'active', label: '正常' },
          { value: 'disabled', label: '已停用' },
        ],
        span: 1,
        listShow: true,
      },
    ],
  },
};

/** 允许的字段类型（用于服务端白名单过滤） */
const FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'bool', 'image', 'tags', 'date', 'password', 'color'];

/* ---------------------------------------------------------------- 选项解析 */

function optionsFor(def, ctx) {
  if (Array.isArray(def.options)) return def.options;
  if (def.options === 'projects') {
    const rows = require('./db').all('SELECT id, title FROM projects ORDER BY sort_order, id');
    return [{ value: '', label: '— 不关联 —' }].concat(
      rows.map((r) => ({ value: r.id, label: r.title }))
    );
  }
  if (def.options === 'users') {
    const rows = require('./db').all('SELECT id, display_name, username FROM users ORDER BY id');
    return [{ value: '', label: '— 未指定 —' }].concat(
      rows.map((r) => ({ value: r.id, label: `${r.display_name || r.username}（${r.username}）` }))
    );
  }
  if (def.options === 'roles') {
    return Object.keys(ROLES).map((k) => ({ value: k, label: ROLES[k].label }));
  }
  return [];
}

/* ---------------------------------------------------------------- 后台外壳 */

function adminNavGroups(ctx) {
  const can = ctx.can;
  const counts = ctx.counts || {};
  const groups = [];

  groups.push({
    title: '概览',
    items: [{ href: '/admin', label: '工作台', icon: 'home', exact: true }],
  });

  if (can('content')) {
    groups.push({
      title: '内容管理',
      items: [
        { href: '/admin/projects', label: '项目', icon: 'box', count: counts.projects },
        { href: '/admin/showcases', label: '工坊内容', icon: 'palette', count: counts.showcases },
        { href: '/admin/pages', label: '自建页面', icon: 'file', count: counts.pages },
        { href: '/admin/announcements', label: '公告', icon: 'megaphone', count: counts.announcements },
        { href: '/admin/friends', label: '友情链接', icon: 'link', count: counts.friends },
        { href: '/admin/nav_items', label: '导航菜单', icon: 'list', count: counts.nav_items },
      ],
    });
    groups.push({
      title: '媒体',
      items: [{ href: '/admin/media', label: '媒体库', icon: 'image', count: counts.media }],
    });
  }

  if (can('oa')) {
    groups.push({
      title: '协同办公',
      items: [
        { href: '/admin/tasks', label: '任务', icon: 'clipboard', count: counts.tasks_open },
        { href: '/admin/approvals', label: '审批', icon: 'check', count: counts.approvals_pending },
        { href: '/admin/board', label: '任务看板', icon: 'grid' },
      ],
    });
  }

  if (can('users')) {
    groups.push({
      title: '组织',
      items: [{ href: '/admin/users', label: '成员与权限', icon: 'users', count: counts.users }],
    });
  }

  if (can('messages') || can('audit') || can('settings')) {
    const items = [];
    if (can('messages')) items.push({ href: '/admin/messages', label: '留言', icon: 'mail', count: counts.messages_new });
    if (can('audit')) items.push({ href: '/admin/audit', label: '操作日志', icon: 'shield' });
    if (can('settings')) items.push({ href: '/admin/settings', label: '站点设置', icon: 'settings' });
    if (items.length) groups.push({ title: '系统', items });
  }

  return groups;
}

function adminShell(ctx) {
  const u = ctx.user;
  const groups = adminNavGroups(ctx);
  const path = ctx.path;
  const initial = ((u.display_name || u.username || 'P')[0] || 'P').toUpperCase();

  const navHtml = groups
    .map(
      (g) => `<div class="admin-nav__group">
  <div class="admin-nav__title">${R.esc(g.title)}</div>
  ${g.items
    .map((it) => {
      const active = it.exact ? path === it.href : path === it.href || path.startsWith(it.href + '/');
      return `<a class="admin-nav__link${active ? ' is-active' : ''}" href="${R.escAttr(it.href)}">
    ${R.icon(it.icon, 18)}<span>${R.esc(it.label)}</span>
    ${it.count ? `<span class="admin-nav__count">${R.esc(String(it.count))}</span>` : ''}
  </a>`;
    })
    .join('')}
</div>`
    )
    .join('');

  const body = `
<div class="admin-shell" id="adminShell">
  <aside class="admin-side">
    <div class="admin-side__brand">
      <img src="/assets/brand/logo-mark.png" alt="">
      <span>
        <b>${R.esc(ctx.settings.site_name || '橙曦澎湃')}</b>
        <i>协同管理后台 · ${R.esc(ctx.settings.site_abbr || 'Prax')}</i>
      </span>
    </div>
    <nav class="admin-nav">${navHtml}</nav>
    <div class="admin-side__user">
      <span class="avatar">${R.esc(initial)}</span>
      <span style="min-width:0">
        <b>${R.esc(u.display_name || u.username)}</b>
        <i>${R.esc(R.roleLabel(u.role))}</i>
      </span>
      <button class="modal__x" id="logoutBtn" title="退出登录" aria-label="退出登录" style="margin-left:auto">${R.icon(
        'logout',
        16
      )}</button>
    </div>
  </aside>

  <div class="admin-main">
    <header class="admin-top">
      <button class="modal__x admin-side__toggle" id="adminNavToggle" aria-label="打开菜单">${R.icon('menu', 18)}</button>
      <div>
        <h1>${R.esc(ctx.pageTitle || '工作台')}</h1>
        ${ctx.pageSub ? `<div class="admin-top__sub">${R.esc(ctx.pageSub)}</div>` : ''}
      </div>
      <div class="admin-top__act">
        <a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener">${R.icon('external', 15)}查看前台</a>
      </div>
    </header>
    <div class="admin-body">
      ${ctx.body}
    </div>
  </div>
</div>`;

  return R.layout({
    page: 'admin',
    bodyClass: 'page-admin',
    title: ctx.pageTitle || '协同后台',
    description: '橙曦澎湃协同管理后台',
    // editor.css 只在页面编辑器用到，但体积很小，统一加载省去按页判断
    styles: ['/assets/css/admin.css', '/assets/css/editor.css'],
    // 按页附加的脚本（例如页面编辑器的 page-editor.js）必须透传下去，
    // 否则 sendPage 传了 scripts 也不会被渲染出来。
    scripts: ctx.scripts || [],
    settings: ctx.settings,
    user: ctx.user,
    body,
    noPreload: true,
  });
}

/* ---------------------------------------------------------------- 字段渲染 */

function renderField(def, row, ctx) {
  const name = def.name;
  const raw = row ? row[name] : undefined;
  const val = raw === undefined || raw === null ? '' : raw;
  const id = 'f_' + name;
  const span = def.span || 1;
  const style = span > 1 ? ` style="grid-column:span ${span}"` : '';
  const req = def.required ? ' required' : '';
  const hint = def.hint ? `<div class="hint">${R.esc(def.hint)}</div>` : '';

  if (def.type === 'static') {
    return `<div class="field"${style}><span class="label">${R.esc(def.label)}</span>
      <div>${def.render ? def.render(row, ctx) : R.esc(val)}</div>${hint}</div>`;
  }

  // 布尔开关：隐藏域保证未勾选时也会提交 0
  if (def.type === 'bool') {
    const on = val === 1 || val === true || val === '1';
    return `<div class="field"${style}>
      <span class="label">${R.esc(def.label)}</span>
      <label class="switch">
        <input type="hidden" name="${R.escAttr(name)}" value="0">
        <input type="checkbox" name="${R.escAttr(name)}" value="1"${on ? ' checked' : ''}>
        <span class="switch__track"></span>
        <span>${on ? '已开启' : '已关闭'}</span>
      </label>
      ${hint}
    </div>`;
  }

  if (def.type === 'select') {
    const opts = optionsFor(def, ctx);
    const cur = String(val);
    return `<div class="field"${style}>
      <label for="${id}">${R.esc(def.label)}</label>
      <select class="select" id="${id}" name="${R.escAttr(name)}"${req}>
        ${opts
          .map(
            (o) =>
              `<option value="${R.escAttr(o.value)}"${String(o.value) === cur ? ' selected' : ''}>${R.esc(
                o.label
              )}</option>`
          )
          .join('')}
      </select>
      ${hint}
    </div>`;
  }

  if (def.type === 'textarea') {
    return `<div class="field"${style}>
      <label for="${id}">${R.esc(def.label)}</label>
      <textarea class="textarea" id="${id}" name="${R.escAttr(name)}"${
      def.placeholder ? ` placeholder="${R.escAttr(def.placeholder)}"` : ''
    }${req}>${R.esc(val)}</textarea>
      ${hint}
    </div>`;
  }

  if (def.type === 'tags') {
    const text = Array.isArray(val) ? val.join(', ') : String(val || '');
    return `<div class="field"${style}>
      <label for="${id}">${R.esc(def.label)}</label>
      <input class="input" id="${id}" name="${R.escAttr(name)}" value="${R.escAttr(text)}" placeholder="用逗号分隔">
      ${hint}
    </div>`;
  }

  if (def.type === 'image') {
    return `<div class="field"${style}>
      <label for="${id}">${R.esc(def.label)}</label>
      <div class="media-field">
        <div class="media-field__preview" data-preview-for="${R.escAttr(name)}">
          ${
            val
              ? `<img src="${R.escAttr(val)}" alt="">`
              : `<span class="media-field__empty">${R.icon('image', 22)}</span>`
          }
        </div>
        <div class="media-field__side">
          <input class="input" id="${id}" name="${R.escAttr(name)}" value="${R.escAttr(val)}" placeholder="/assets/... 或 https://...">
          <div class="row-inline">
            <button class="btn btn-ghost btn-sm" type="button" data-modal-open="mediaModal">${R.icon(
              'image',
              14
            )}媒体库</button>
            <label class="btn btn-ghost btn-sm" style="cursor:pointer">
              ${R.icon('plus', 14)}上传
              <input type="file" accept="image/*" hidden data-upload-for="${R.escAttr(name)}">
            </label>
            <button class="btn btn-ghost btn-sm" type="button" data-clear-for="${R.escAttr(name)}">${R.icon(
              'close',
              14
            )}清空</button>
          </div>
        </div>
      </div>
      ${hint}
    </div>`;
  }

  const type = def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : def.type === 'password' ? 'password' : 'text';
  return `<div class="field"${style}>
    <label for="${id}">${R.esc(def.label)}</label>
    <input class="input" id="${id}" type="${type}" name="${R.escAttr(name)}" value="${R.escAttr(val)}"${
    def.placeholder ? ` placeholder="${R.escAttr(def.placeholder)}"` : ''
  }${req}>
    ${hint}
  </div>`;
}

/* ---------------------------------------------------------------- 列表渲染 */

function cellValue(def, row, ctx) {
  const v = row[def.name];

  if (def.type === 'bool') {
    const on = v === 1 || v === true || v === '1';
    return `<span class="badge badge-${on ? 'ok' : 'muted'}">${on ? '是' : '否'}</span>`;
  }

  if (def.type === 'select') {
    const opts = optionsFor(def, ctx);
    const hit = opts.find((o) => String(o.value) === String(v));
    if (def.name === 'status') return R.statusBadge(v);
    if (def.name === 'priority') return R.badge(v);
    if (def.name === 'role') return `<span class="badge badge-brand">${R.esc(hit ? hit.label : v)}</span>`;
    return R.esc(hit ? hit.label : v);
  }

  if (def.type === 'tags') {
    const arr = Array.isArray(v) ? v : [];
    return arr.length
      ? arr
          .slice(0, 3)
          .map((t) => `<span class="tag">${R.esc(t)}</span>`)
          .join(' ')
      : '<span class="muted">—</span>';
  }

  if (def.type === 'image') {
    return v ? `<img class="thumb" src="${R.escAttr(v)}" alt="">` : '<span class="muted">—</span>';
  }

  if (def.type === 'number') {
    return v === null || v === undefined || v === '' ? '<span class="muted">—</span>' : R.esc(String(v));
  }

  return v ? R.esc(String(v)) : '<span class="muted">—</span>';
}

function resourceList(ctx, res, list, opts) {
  const o = opts || {};
  const listFields = res.fields.filter((f) => f.listShow);
  const canWrite = ctx.can(res.perm);

  const head = listFields.map((f) => `<th>${R.esc(f.label)}</th>`).join('');

  const rows = list
    .map((row) => {
      const tds = listFields
        .map((f) => {
          if (f.name === 'title' || f.name === 'name' || f.name === 'label' || f.name === 'username') {
            const sub = row.slug || row.url || row.href || row.email || '';
            return `<td><div class="t-title">${R.esc(row[f.name])}</div>${
              sub ? `<div class="t-sub">${R.esc(R.truncate(sub, 46))}</div>` : ''
            }</td>`;
          }
          return `<td>${cellValue(f, row, ctx)}</td>`;
        })
        .join('');
      return `<tr>
  ${tds}
  <td class="col-act">
    ${
      canWrite
        ? `<a class="btn btn-ghost btn-sm" href="/admin/${res.key}/${row.id}">${R.icon('pencil', 14)}编辑</a>
           <button class="btn btn-ghost btn-sm" type="button" data-action="delete" data-resource="${res.key}" data-id="${
            row.id
          }" data-confirm="确定删除「${R.escAttr(row.title || row.name || row.label || row.username || row.id)}」吗？">${R.icon(
            'trash',
            14
          )}</button>`
        : ''
    }
  </td>
</tr>`;
    })
    .join('');

  return `<div class="table-wrap">
  <div class="table-scroll">
    <table class="data">
      <thead><tr>${head}<th class="col-act">操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  ${
    list.length
      ? ''
      : `<div class="empty" style="border:0;border-radius:0">${R.icon(res.icon, 32)}<p>还没有${R.esc(
          res.single
        )}记录。</p></div>`
  }
</div>`;
}

/* ---------------------------------------------------------------- 表单页 */

function resourceForm(ctx, res, row) {
  const isEdit = !!row;
  const groups = {};
  res.fields.forEach((f) => {
    const g = f.group || '基本信息';
    (groups[g] = groups[g] || []).push(f);
  });

  const grid = (fields) =>
    `<div class="grid-3">${fields.map((f) => renderField(f, row, ctx)).join('')}</div>`;

  // 前台真实访问路径。项目是 /p/<slug>，工坊内容都在 /atelier 一页上，
  // 其余资源没有独立公开页面 —— 不要显示 /admin/xxx 这种后台内部路径。
  let publicPath = '';
  if (row && row.slug) {
    if (res.key === 'projects') publicPath = `/p/${row.slug}`;
    else if (res.key === 'showcases') publicPath = '/atelier';
  }

  return `<form data-ajax action="${isEdit ? `/api/${res.key}/${row.id}` : `/api/${res.key}`}"${
    isEdit ? ' data-method="PATCH"' : ''
  }>
  <div class="panel">
    <div class="panel__head">
      <h3>${isEdit ? '编辑' : '新建'}${R.esc(res.single)}</h3>
      ${
        publicPath
          ? `<span class="toolbar__spacer"></span>
             <a class="muted mono" href="${R.escAttr(publicPath)}" target="_blank" rel="noopener"
                title="在新窗口查看前台效果">${R.esc(publicPath)} ↗</a>`
          : ''
      }
    </div>
    <div class="panel__body">${grid(res.fields)}</div>
    <div class="panel__foot">
      <button class="btn btn-primary" type="submit">${R.icon('check', 16)}${isEdit ? '保存修改' : '创建'}</button>
      <a class="btn btn-ghost" href="/admin/${res.key}">取消</a>
      ${
        isEdit && ctx.can(res.perm)
          ? `<span class="toolbar__spacer"></span>
             <button class="btn btn-ghost" type="button" data-action="delete" data-resource="${res.key}" data-id="${
              row.id
            }" data-confirm="确定删除这条${R.esc(res.single)}吗？此操作不可撤销。">${R.icon('trash', 15)}删除</button>`
          : ''
      }
    </div>
  </div>
</form>`;
}

/* ---------------------------------------------------------------- 媒体选择弹窗 */

function mediaPickerModal(mediaList) {
  const items = mediaList
    .map((m) => {
      const isVideo = m.kind === 'video';
      const isAudio = m.kind === 'audio';
      const preview = isVideo
        ? `<video class="media-item__video" src="${R.escAttr(m.url)}" muted preload="metadata"></video>`
        : isAudio
        ? `<span class="media-item__audio">${R.icon('bolt', 20)}</span>`
        : `<img src="${R.escAttr(m.url)}" alt="${R.escAttr(m.original_name || m.filename)}" loading="lazy">`;
      return `<button class="media-item" type="button" data-action="pick" data-url-value="${R.escAttr(m.url)}">
  ${preview}
  <span>${R.esc(R.truncate(m.original_name || m.filename, 22))}</span>
</button>`;
    })
    .join('');

  return `<div class="modal" id="mediaModal" role="dialog" aria-modal="true" aria-label="媒体库">
  <div class="modal__veil" data-modal-close></div>
  <div class="modal__panel modal-lg">
    <div class="modal__head">
      <h3>选择媒体</h3>
      <button class="modal__x" type="button" data-modal-close aria-label="关闭">${R.icon('close', 18)}</button>
    </div>
    <div class="modal__body">
      ${
        mediaList.length
          ? `<div class="media-grid">${items}</div>`
          : `<div class="empty">${R.icon('image', 32)}<p>媒体库还是空的，先上传或添加一个外链媒体吧。</p></div>`
      }
    </div>
    <div class="modal__foot">
      <label class="btn btn-primary btn-sm" style="cursor:pointer">
        ${R.icon('plus', 15)}上传新媒体
        <input type="file" accept="image/*,video/*,audio/*" hidden data-upload-for="__new__">
      </label>
      <a class="btn btn-ghost btn-sm" href="/admin/media">进入媒体库</a>
    </div>
  </div>
</div>`;
}

module.exports = {
  RESOURCES,
  FIELD_TYPES,
  CATEGORY_PROJECT,
  CATEGORY_SHOWCASE,
  TASK_STATUS,
  TASK_PRIORITY,
  APPROVAL_STATUS,
  optionsFor,
  adminShell,
  resourceList,
  resourceForm,
  renderField,
  mediaPickerModal,
  adminNavGroups,
};
