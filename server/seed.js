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
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (!get('SELECT key FROM settings WHERE key = ?', k)) setSetting(k, v);
  }
}

function seedUsers() {
  if (!isEmpty('users')) return;
  // 允许用环境变量覆盖初始管理员口令（容器部署时避免用默认弱口令）
  const adminPwd = process.env.PRAX_ADMIN_PASSWORD || 'admin123';
  const users = [
    ['admin', adminPwd, '站点管理员', 'admin', '负责人', '综合组', 'admin@example.com'],
    ['rootpi', 'prax1234', 'Rootpi', 'staff', '开发', '技术组', 'rootpi@example.com'],
    ['xiaocheng', 'prax1234', 'Xiaocheng', 'staff', '设计', '设计组', 'xiaocheng@example.com'],
    ['editor', 'prax1234', '内容编辑', 'editor', '编辑', '综合组', 'editor@example.com'],
  ];
  for (const [username, pwd, display, role, title, dept, email] of users) {
    run(
      `INSERT INTO users (username, password_hash, display_name, role, title, dept, email)
       VALUES (?,?,?,?,?,?,?)`,
      username,
      hashPassword(pwd),
      display,
      role,
      title,
      dept,
      email
    );
  }
  console.log('  · 已创建 %d 个账号（admin / rootpi / xiaocheng / editor）', users.length);
  if (process.env.PRAX_ADMIN_PASSWORD) {
    console.log('  · 管理员口令取自 PRAX_ADMIN_PASSWORD 环境变量');
  } else {
    console.log('  · 管理员初始口令为默认值，请登录后立即修改');
  }
}

function seedNav() {
  if (!isEmpty('nav_items')) return;
  // 注意：这里**不**放「关于」。
  // 「关于我们」是一个自建页面，它勾了「加入导航」，会由 loadNav() 自动并入页头；
  // 若这里再放一个 /#about 的锚点，页头就会出现两个「关于」。
  const items = [
    ['首页', '/', 10],
    ['项目', '/#projects', 20],
    ['工坊', '/atelier', 30],
    ['公告', '/#news', 40],
    ['协同入口', '/admin', 60],
  ];
  items.forEach(([label, href, order]) => {
    run('INSERT INTO nav_items (label, href, sort_order) VALUES (?,?,?)', label, href, order);
  });
}

function seedProjects() {
  if (!isEmpty('projects')) return;
  const projects = [
    {
      title: 'Prax 门户与协同平台',
      slug: 'prax-portal',
      subtitle: 'Portal & OA Platform',
      summary:
        '橙曦澎湃的对外门户与内部协同平台。前台负责品牌呈现与项目索引，后台负责内容编排与团队协作。',
      body:
        '本项目同时承担两个角色：\n\n' +
        '一是组织对外的门户，集中展示各条项目线的进度与产出；\n' +
        '二是内部协同的入口，提供项目、任务、审批、公告与操作日志等 OA 能力。\n\n' +
        '所有对外内容均可在后台配置：链接指向、封面、分类、标签，以及在首页是否展示。',
      cover: `${IMG}/hero-portal.jpg`,
      link_url: '/',
      repo_url: '',
      link_label: '进入门户',
      category: 'platform',
      tags: ['门户', 'OA', 'Node.js'],
      featured: 1,
      sort_order: 10,
    },
    {
      title: 'BetterStorage 储存网络',
      slug: 'betterstorage',
      subtitle: 'Minecraft Storage Network',
      summary:
        '面向 Minecraft 服务端的储存网络插件：控制器、磁盘驱动器、无线终端与跨维度数据连接，构建可扩展的物资体系。',
      body:
        '以「储存网络」为单位组织物资：控制器负责索引，磁盘提供容量，访问点与无线终端负责取用。\n\n' +
        '每条网络彼此独立，支持无限容量与无限距离升级，并提供跨维度卡与信号延长器处理复杂地形下的连接问题。',
      cover: COVER('ember'),
      link_url: 'https://gitee.com/RootpiXiaocheng',
      repo_url: 'https://gitee.com/RootpiXiaocheng',
      link_label: '查看仓库',
      category: 'plugin',
      tags: ['Minecraft', 'Paper', '插件'],
      featured: 1,
      sort_order: 20,
    },
    {
      title: 'PraxVD 村民防御',
      slug: 'praxvd',
      subtitle: 'Villager Defense',
      summary:
        '把村庄防御做成可配置的竞技玩法：竞技场、波次、路径点与贴墙上楼，配合语言文件的严格校验。',
      body:
        '以竞技场为单位组织防御玩法，支持波次编排、路径点编辑与贴墙上楼等地图能力。\n\n' +
        '所有玩家可见文本走语言键读取，缺键时回退默认值，避免整份语言文件被判为损坏。',
      cover: COVER('dusk'),
      link_url: 'https://github.com/Xiaochengsweet233',
      repo_url: 'https://github.com/Xiaochengsweet233',
      link_label: '查看仓库',
      category: 'plugin',
      tags: ['Minecraft', '玩法', '插件'],
      featured: 0,
      sort_order: 30,
    },
    {
      title: 'QualityArmory 资源包适配',
      slug: 'qualityarmory',
      subtitle: 'Resource Pack Compatibility',
      summary:
        '修复资源包在现代客户端上的整体失效问题：贴图目录结构与 pack_format 版本迁移。',
      body:
        '现代客户端对资源包目录结构有明确要求。本项目处理贴图目录迁移与 pack_format 升级，\n\n' +
        '并顺带修复了受伤提示的相关表现，使老资源包能够在新版本客户端上正常工作。',
      cover: COVER('amber'),
      link_url: '',
      repo_url: 'https://gitee.com/RootpiXiaocheng',
      link_label: '查看仓库',
      category: 'plugin',
      tags: ['资源包', '兼容性'],
      featured: 0,
      sort_order: 40,
    },
    {
      title: '橙曦视觉规范',
      slug: 'prax-visual',
      subtitle: 'Visual Identity',
      summary:
        '以柑橘切面为核心意象的视觉规范：主色取自官方标识，统一门户、工坊与协同后台的观感。',
      body:
        '视觉体系提炼自官方标识的三支主色：橙红、明黄与米白。\n\n' +
        '门户以橙红为底、强调现代感；工坊以米白为底、橙黄为点缀，用于承载设计类内容。',
      cover: COVER('aurora'),
      link_url: '/atelier',
      repo_url: '',
      link_label: '进入工坊',
      category: 'design',
      tags: ['设计', '品牌'],
      featured: 1,
      sort_order: 50,
    },
    {
      title: '内部工具链',
      slug: 'prax-toolchain',
      subtitle: 'Internal Toolchain',
      summary: '构建、校验与交付流程的自动化脚本集合，减少重复的手工操作。',
      body: '把重复的动作固化成脚本：构建、检查、打包与交付。让每次发版都走同一条路径。',
      cover: COVER('slate'),
      link_url: '',
      repo_url: '',
      link_label: '了解详情',
      category: 'project',
      tags: ['工具链', '自动化'],
      featured: 0,
      sort_order: 60,
    },
  ];

  for (const p of projects) {
    run(
      `INSERT INTO projects
        (title, slug, subtitle, summary, body, cover, link_url, repo_url, link_label,
         category, tags, featured, sort_order, visible)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      p.title,
      p.slug,
      p.subtitle,
      p.summary,
      p.body,
      p.cover,
      p.link_url,
      p.repo_url,
      p.link_label,
      p.category,
      JSON.stringify(p.tags),
      p.featured,
      p.sort_order
    );
  }
}

function seedShowcases() {
  if (!isEmpty('showcases')) return;
  const items = [
    {
      title: '柑橘切面系列图标',
      slug: 'citrus-icon-set',
      subtitle: 'Icon Set',
      summary: '从标识的切面结构里抽出一套图标语言，用于门户与工坊的装饰体系。',
      body:
        '把标识里的同心色环与放射分缝抽成可复用的图形规则，\n\n' +
        '再以此推导出封面、分隔纹样与背景装饰。整套图形只使用三支品牌色，保证一致性。',
      cover: COVER('sunrise'),
      link_url: '',
      category: 'side',
      tags: ['图形', '品牌'],
      year: '2026',
      credit: '设计作业副产品',
      featured: 1,
      sort_order: 10,
    },
    {
      title: '门户主视觉实验',
      slug: 'portal-keyvisual',
      subtitle: 'Key Visual',
      summary: '以进站动效为目标的主视觉尝试：橙色渐变、放射光带与同心圆弧。',
      body:
        '目标是「进入网站就有现代感」。最终方案用橙红渐变打底，叠放射光带与同心圆弧，\n\n' +
        '再把标识以低透明度压成水印，形成品牌记忆点。',
      cover: `${IMG}/hero-portal.jpg`,
      link_url: '/',
      category: 'linked',
      tags: ['视觉', '动效'],
      year: '2026',
      credit: '与门户联动',
      featured: 1,
      sort_order: 20,
    },
    {
      title: '米白纸面卡片体系',
      slug: 'cream-card-system',
      subtitle: 'Card System',
      summary: '为工坊页面设计的卡片体系：米白纸面、橙色描边与轻量网格底纹。',
      body: '卡片以米白纸面为底，边缘保留极淡的橙色描边与网格，营造设计稿的手感。',
      cover: COVER('linen'),
      link_url: '/atelier',
      category: 'side',
      tags: ['界面', '排版'],
      year: '2026',
      credit: '设计作业副产品',
      featured: 0,
      sort_order: 30,
    },
    {
      title: '协同后台界面草案',
      slug: 'oa-ui-draft',
      subtitle: 'Admin UI Draft',
      summary: '内部协同后台的界面草案，与门户共用品牌色，但转向深色以降低长时间操作的疲劳。',
      body: '后台需要长时间停留，因此改用深色底，只保留品牌色作为强调与状态指示。',
      cover: `${IMG}/admin-side.jpg`,
      link_url: '/admin',
      category: 'linked',
      tags: ['界面', '后台'],
      year: '2026',
      credit: '与门户联动',
      featured: 0,
      sort_order: 40,
    },
    {
      title: '封面生成脚本',
      slug: 'cover-generator',
      subtitle: 'Cover Generator',
      summary: '用脚本批量生成风格一致的封面与主视觉，避免手工配图的随机性。',
      body:
        '配图最容易失控。于是把配色、构图与装饰规则写进脚本，\n\n' +
        '一次运行即可产出全套尺寸一致的封面、主视觉与纹样。',
      cover: COVER('ember'),
      link_url: '',
      category: 'side',
      tags: ['脚本', '自动化'],
      year: '2026',
      credit: '设计作业副产品',
      featured: 0,
      sort_order: 50,
    },
    {
      title: '排版与留白练习',
      slug: 'typography-study',
      subtitle: 'Typography',
      summary: '中文与西文混排的间距练习，沉淀为门户的排版基线。',
      body: '统一标题与正文的行高、字距与断行规则，让中英混排也能保持稳定的阅读节奏。',
      cover: COVER('amber'),
      link_url: '',
      category: 'side',
      tags: ['排版', '字体'],
      year: '2026',
      credit: '设计作业副产品',
      featured: 0,
      sort_order: 60,
    },
  ];

  for (const s of items) {
    run(
      `INSERT INTO showcases
        (title, slug, subtitle, summary, body, cover, link_url, category, tags,
         year, credit, featured, sort_order, visible)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      s.title,
      s.slug,
      s.subtitle,
      s.summary,
      s.body,
      s.cover,
      s.link_url,
      s.category,
      JSON.stringify(s.tags),
      s.year,
      s.credit,
      s.featured,
      s.sort_order
    );
  }
}

function seedFriends() {
  if (!isEmpty('friends')) return;
  // 用户提供的两个友情链接
  const items = [
    ['Gitee · RootpiXiaocheng', 'https://gitee.com/RootpiXiaocheng', '代码托管 · Gitee 主页', 10],
    ['GitHub · Xiaochengsweet233', 'https://github.com/Xiaochengsweet233', '代码托管 · GitHub 主页', 20],
  ];
  for (const [name, url, desc, order] of items) {
    run(
      'INSERT INTO friends (name, url, description, sort_order, visible) VALUES (?,?,?,?,1)',
      name,
      url,
      desc,
      order
    );
  }
}

function seedAnnouncements() {
  if (!isEmpty('announcements')) return;
  const items = [
    {
      title: '门户与协同平台正式上线',
      summary: '对外门户与内部协同后台完成首轮建设，所有项目链接与展示状态均可在后台调整。',
      body:
        '本次上线包含三部分：\n\n' +
        '一、对外门户：展示组织、项目线、公告与友情链接；\n' +
        '二、橙曦工坊：收录设计作业副产品与联动内容；\n' +
        '三、协同后台：提供项目、任务、审批、公告、成员与操作日志能力。',
      tag: '公告',
      pinned: 1,
    },
    {
      title: '项目链接与首页展示改为后台配置',
      summary: '项目的指向链接、封面、标签与是否在首页展示，均已支持在后台直接维护。',
      body: '在「内容管理 → 项目」中可设置每个项目的指向链接、封面图、标签与展示开关，前台即时生效。',
      tag: '更新',
      pinned: 0,
    },
    {
      title: '视觉规范统一为品牌三色',
      summary: '门户、工坊与后台统一使用取自官方标识的橙红、明黄与米白。',
      body: '主色橙红 #C34C18、强调色明黄 #F2B603、纸面色米白 #F6F5EF，均直接从官方标识采样得到。',
      tag: '设计',
      pinned: 0,
    },
  ];
  for (const a of items) {
    run(
      `INSERT INTO announcements (title, summary, body, tag, pinned, visible)
       VALUES (?,?,?,?,?,1)`,
      a.title,
      a.summary,
      a.body,
      a.tag,
      a.pinned
    );
  }
}

function seedOA() {
  if (!isEmpty('tasks')) return;
  const users = all('SELECT id, username FROM users');
  const byName = (n) => {
    const u = users.find((x) => x.username === n);
    return u ? u.id : null;
  };
  const admin = byName('admin');

  const tasks = [
    ['门户首屏动效调优', '调整进站动画节奏与缓动曲线，保证在中低端设备上也不掉帧。', 'prax-portal', 'rootpi', 'high', 'doing', 60, 5],
    ['工坊内容结构梳理', '梳理设计副产品与联动内容的分类方式，确定展示层级。', 'prax-visual', 'xiaocheng', 'normal', 'todo', 20, 9],
    ['资源包兼容性回归', '在多个客户端版本上回归资源包加载与贴图表现。', 'qualityarmory', 'rootpi', 'normal', 'doing', 40, 12],
    ['协同后台权限矩阵复核', '复核四种角色对内容、协同、成员与设置模块的可见范围。', 'prax-portal', 'admin', 'high', 'todo', 0, 15],
    ['封面生成脚本参数化', '把配色与构图参数抽成配置，便于批量产出不同风格的封面。', 'prax-toolchain', 'xiaocheng', 'low', 'done', 100, 3],
    ['公告发布流程约定', '约定公告的撰写、审核与置顶规则。', 'prax-portal', 'editor', 'normal', 'done', 100, 2],
  ];

  for (const [title, desc, slug, assignee, priority, status, progress, due] of tasks) {
    const proj = get('SELECT id FROM projects WHERE slug = ?', slug);
    const due_date = new Date(Date.now() + due * 86400 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    run(
      `INSERT INTO tasks (title, description, project_id, assignee_id, creator_id,
        priority, status, progress, due_date)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      title,
      desc,
      proj ? proj.id : null,
      byName(assignee),
      admin,
      priority,
      status,
      progress,
      `${due_date.getFullYear()}-${pad(due_date.getMonth() + 1)}-${pad(due_date.getDate())}`
    );
  }

  const approvals = [
    ['门户服务器续费', '服务器', 'admin', 'rootpi', 480, '现有实例到期，申请续费一年。', 'pending', ''],
    ['设计素材采购', '采购', 'xiaocheng', 'admin', 260, '需要补充一批可用于封面与展示的素材授权。', 'pending', ''],
    ['域名与证书', '采购', 'rootpi', 'admin', 120, '域名续期与证书签发。', 'approved', '已核对预算，同意。'],
    ['外设更换', '资产', 'editor', 'admin', 0, '现有键盘损坏，申请更换。', 'rejected', '暂缓，本次不列入预算。'],
  ];
  for (const [title, kind, applicant, approver, amount, reason, status, note] of approvals) {
    run(
      `INSERT INTO approvals (title, kind, applicant_id, approver_id, amount, reason, status, decision_note, decided_at)
       VALUES (?,?,?,?,?,?,?,?, ${status === 'pending' ? 'NULL' : "datetime('now','localtime')"})`,
      title,
      kind,
      byName(applicant),
      byName(approver),
      amount,
      reason,
      status,
      note
    );
  }
}

function seedPages() {
  if (!isEmpty('pages')) return;

  // 一页 Markdown、两页 Markdown/HTML 演示，正好把两种格式都摊开
  const items = [
    {
      title: '关于我们',
      slug: 'about',
      format: 'markdown',
      layout: 'cream',
      summary: '橙曦澎湃是什么、在做什么、怎么联系。',
      body: `# 关于橙曦澎湃

**橙曦澎湃**（Project Rootpi & Xiaocheng，简称 *Prax*）是一个专注于
插件开发、工具链建设与设计实践的小型创作组织。

## 我们在做什么

- **插件开发** —— 面向 Minecraft 服务端的实用插件
- **工具链建设** —— 把重复动作固化成脚本
- **设计实践** —— 视觉规范与界面设计

## 怎么做事

> 先跑通最小闭环，再补细节；每次改动都可回退。

我们关心的是「东西能不能真的用起来」，而不是「看起来是不是很厉害」。

## 联系

| 渠道 | 地址 |
| --- | --- |
| 邮箱 | contact@example.com |
| 代码托管 | [Gitee](https://gitee.com/RootpiXiaocheng) |

---

这个页面本身就是用 **Markdown** 写的。登录后台的「自建页面」就能直接改。
`,
      in_nav: 1,
      nav_label: '关于',
      visible: 1,
      // 与 nav_items 的排序刻度保持一致，让它落在「公告」之后、「协同入口」之前
      sort_order: 50,
    },
    {
      title: '页面编辑器示例',
      slug: 'editor-demo',
      format: 'markdown',
      layout: 'cream',
      summary: '演示 Markdown 格式能写出什么。',
      body: `# 自建页面能做什么

这个页面用来演示「页面编辑器」。你能在后台写出任意页面，不用改一行代码。

## 一、Markdown 模式

适合写文章、说明与文档。正文里的 HTML 会被**安全地显示成文字**，不会执行。

### 支持的语法

1. 标题、粗体、斜体、删除线
2. 有序 / 无序 / 嵌套列表
3. 表格、引用、分隔线
4. 代码块与行内代码
5. 图片与链接

\`\`\`js
// 代码块会原样展示，不会执行
const prax = { name: '橙曦澎湃', abbr: 'Prax' };
console.log(prax.abbr);
\`\`\`

### 表格示例

| 功能 | 推荐格式 | 说明 |
| --- | --- | --- |
| 写文章 | Markdown | 语法简单，专注内容 |
| 做排版 | HTML | 可自由控制样式 |

## 二、HTML 模式

适合需要精细排版的页面：分栏、卡片、自定义样式。

> 出于安全考虑，\`script\`、\`iframe\` 与 \`onclick\` 这类事件属性会在保存时被自动清除。
> 这样既保留了排版自由，又不会让页面变成安全隐患。

## 三、小技巧

- 编辑器右侧是**实时预览**，所见即前台所得
- \`Ctrl + B\` 加粗、\`Ctrl + K\` 插入链接、\`Ctrl + S\` 保存
- 每次保存都会**自动留档**，写坏了可以随时回滚
- 勾选「加入导航」后，页面会自动出现在网站页头
`,
      in_nav: 0,
      nav_label: '',
      visible: 1,
      sort_order: 20,
    },
    {
      title: 'HTML 排版演示',
      slug: 'html-demo',
      format: 'html',
      layout: 'cream',
      summary: '用 HTML 格式做的卡片式页面，展示排版自由度。',
      body: `<p>这个页面用 <strong>HTML 格式</strong>编写，可以直接控制样式与结构。</p>

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:28px 0">
  <div style="padding:22px;border:1px solid rgba(195,76,24,.22);border-radius:16px;background:#fff">
    <h3 style="margin:0 0 8px;color:#c34c18">自由排版</h3>
    <p style="margin:0;color:#6b5748;font-size:15px">用 div 加内联样式即可做出分栏、卡片与色块。</p>
  </div>
  <div style="padding:22px;border:1px solid rgba(195,76,24,.22);border-radius:16px;background:#fdf2ea">
    <h3 style="margin:0 0 8px;color:#c34c18">页面级样式</h3>
    <p style="margin:0;color:#6b5748;font-size:15px">也可以在正文里放 style 标签定义本页样式。</p>
  </div>
  <div style="padding:22px;border:1px solid rgba(195,76,24,.22);border-radius:16px;background:#fff">
    <h3 style="margin:0 0 8px;color:#c34c18">安全清洗</h3>
    <p style="margin:0;color:#6b5748;font-size:15px">脚本与事件属性会被自动移除，防止页面被注入。</p>
  </div>
</div>

<h2>一个可折叠区块</h2>
<details>
  <summary>点开看看</summary>
  <p>details 与 summary 也能正常使用，适合做常见问题。</p>
</details>

<blockquote>
  <p>提示：HTML 模式与 Markdown 模式可以在编辑器里随时切换。</p>
</blockquote>

<p style="margin-top:28px;color:#8a7565;font-size:14px">
  想改这个页面？登录后台，进入「内容管理 → 自建页面」。
</p>
`,
      in_nav: 0,
      nav_label: '',
      visible: 1,
      sort_order: 30,
    },
  ];

  for (const p of items) {
    run(
      `INSERT INTO pages (title, slug, format, layout, summary, body, in_nav, nav_label, visible, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      p.title,
      p.slug,
      p.format,
      p.layout,
      p.summary,
      p.body,
      p.in_nav,
      p.nav_label,
      p.visible,
      p.sort_order
    );
  }
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

module.exports = { seed };
