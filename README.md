# 橙曦澎湃 · Prax 门户网站

> Project Rootpi & Xiaocheng（简称 **Prax**）—— 对外门户 + 内部协同（OA）平台。

橙色为主、具备现代感的门户主页，米白与橙色为主的工坊子页面，以及一个能配置
「项目指向链接、封面、标签、是否在首页展示」的完整后台。

---

## 一、快速开始

### 环境要求

- **Node.js ≥ 22.13.0**（推荐 24 LTS；用到内置的 `node:sqlite`，无需任何原生编译依赖）

### 本地启动

**Windows**：双击 `start.bat`

**macOS / Linux**：

```bash
chmod +x start.sh
./start.sh
```

或者手动执行：

```bash
npm install
npm run seed      # 初始化数据（幂等，可重复执行）
npm start
```

启动后访问：

| 入口 | 地址 |
| --- | --- |
| 门户首页 | http://localhost:3000/ |
| 工坊子页面 | http://localhost:3000/atelier |
| 协同后台 | http://localhost:3000/admin |
| 自建页面 | http://localhost:3000/p/<路径> （例如 [`/p/about`](http://localhost:3000/p/about)） |

### 默认账号

| 账号 | 密码 | 角色 | 能做什么 |
| --- | --- | --- | --- |
| `admin` | `admin123` | 超级管理员 | 全部功能 |
| `editor` | `prax1234` | 内容编辑 | 内容、媒体、留言 |
| `rootpi` | `prax1234` | 协作成员 | 协同办公（任务/审批） |
| `xiaocheng` | `prax1234` | 协作成员 | 协同办公（任务/审批） |

> **登录后请立即到「成员与权限」修改密码。**
> 容器部署可用环境变量 `PRAX_ADMIN_PASSWORD` 指定初始管理员口令。

---

## 二、后台能力

### 内容管理

| 模块 | 能力 |
| --- | --- |
| **项目** | 设置指向链接、按钮文字、封面、分类、标签、精选、排序，以及**是否在首页展示** |
| **工坊内容** | 子页面的作品/副产品条目：封面、年份、归属说明、类型、标签、展示开关 |
| **自建页面** | **Markdown / HTML 页面编辑器**，见下一节 |
| **公告** | 标题、摘要、正文、配图、置顶、展示开关 |
| **友情链接** | 名称、链接、说明、排序、展示开关 |
| **导航菜单** | 名称、链接、打开方式、排序、展示开关 |

### 自建页面（页面编辑器）

后台「内容管理 → 自建页面」可以写出**任意页面**，不用改代码就能扩展站点。

- **两种格式**：Markdown（适合写文章）与 HTML（适合精细排版），编辑器内可随时切换
- **实时预览**：右侧预览走**与前台完全相同**的渲染管线，所见即所得
- **历史版本**：每次保存自动留档（每页保留最近 30 个），可查看并一键回滚
- **三种皮肤**：米白（默认）、纯净（无页头页脚）、深橙（同门户首页）
- **加入导航**：勾选后页面自动出现在网站页头
- **路径稳定**：改标题**不会**改动 `/p/路径`；除非你显式修改路径字段

编辑器支持工具栏插入、`Ctrl+B` 加粗、`Ctrl+K` 链接、`Ctrl+S` 保存、
`Tab` 缩进、字数/行数统计，以及 Markdown 语法速查。

#### 关于 HTML 模式的安全性

HTML 模式给的是「能排版」的自由，而不是「能执行脚本」的自由。保存时会被清除：

- `<script>`、`<iframe>`、`<object>`、`<embed>`、`<form>`、`<input>` 等可执行/可交互标签
- `onclick`、`onerror`、`onload` 等所有 `on*` 事件属性
- `javascript:`、`vbscript:` 等危险协议
- `<style>` 里的 `@import`、`expression()`、`behavior:`

会保留：`class`/`id`/`style`、`href`/`src`、表格与列表属性、
`<details>/<summary>`、`data:image/*` 内联图片、以及 `<style>` 里的普通 CSS。

> 创作 HTML 页面需要「内容管理」权限（admin / editor），
> 且每次保存都会写入操作日志。Markdown 模式则始终是全转义的，最安全。

### 站点设置（改完即刻生效，无需改代码）

- **站点信息**：名称、英文名、简称、标语、描述、联系邮箱、页脚署名
- **子页面命名**：子页面的名称 / 英文名 / 副标题 / 介绍 **全部可自定义**
- **首页展示开关**：项目板块、工坊导流、公告板块、友情链接、协同入口、留言表单
- **品牌配色**：主色、强调色、纸面色（默认取自官方标识）

### 协同办公（OA）

- **任务**：关联项目、负责人、优先级、状态、进度、截止日期；提供**看板视图**
- **审批**：类型、申请人、审批人、金额、事由、通过/驳回与审批意见
- **成员与权限**：四种角色、启停用、密码重置（含"至少保留一名管理员"的保护）
- **媒体库**：拖拽上传、点击选图回填到内容字段、复制链接
- **留言**：前台联系表单的消息，可标记已处理
- **操作日志**：所有后台写操作的审计记录（谁、何时、做了什么、来自哪个 IP）

### 角色权限矩阵

| 权限 | admin | editor | staff | member |
| --- | :-: | :-: | :-: | :-: |
| 内容管理 | ✓ | ✓ | | |
| 媒体库 | ✓ | ✓ | | |
| 留言 | ✓ | ✓ | | |
| 协同办公 | ✓ | | ✓ | |
| 成员与权限 | ✓ | | | |
| 站点设置 | ✓ | | | |
| 操作日志 | ✓ | | | |

---

## 三、视觉与配图

品牌色**直接从官方标识 `PRAX.png` 采样**得到，全站统一：

| 角色 | 色值 |
| --- | --- |
| 主色 橙红 | `#C34C18` |
| 强调 明黄 | `#F2B603` |
| 纸面 米白 | `#F6F5EF` |

- **门户首页**：橙色渐变打底，放射光带 + 同心圆弧，进站有品牌加载动效
- **工坊子页面**：米白纸面 + 橙色柑橘切面视觉，偏"设计稿"气质
- **协同后台**：深色侧栏 + 浅色工作区，降低长时间操作的疲劳

所有配图由脚本生成，风格天然统一：

```bash
npm run images      # 重新生成全部配图
```

生成内容：

```
public/assets/brand/    品牌标识（从官方 logo 派生，含透明底、反白版、favicon）
public/assets/img/      门户主视觉、子页视觉、6 张项目封面、OG 分享图
public/assets/pattern/  SVG 纹样（柑橘切面、点阵、波浪分隔）
```

> 换 logo 时，把新图覆盖 `PRAX.png` 再跑一次 `npm run images` 即可。
> 若新 logo 的分行结构与原图差异很大，图标/字标切分规则会自动退回"整体当图标"，
> 不会产出错位的裁切。

---

## 四、部署

### 方式一：Docker 部署（推荐 · 主部署方式）

```bash
docker compose up -d --build
```

- 数据（SQLite + 上传文件）持久化在 `prax-data` 卷中，重建/更新容器**不丢数据**
- 默认端口 `3000`
- 首次启动可用 `PRAX_ADMIN_PASSWORD` 指定初始管理员口令（默认 `admin123`，登录后请立即修改）
- 内置 healthcheck
- 可用 `PRAX_DATA_DIR` / `PRAX_DB_FILE` / `PRAX_UPLOAD_DIR` 把数据与代码分离

### 自动更新（Docker）

```bash
# Linux / macOS
./scripts/update.sh

# Windows
scripts\update.bat
```

脚本会：`git pull` → `docker compose build` → `docker compose up -d`。
由于数据库与上传文件都在 `prax-data` 卷里、且已在 `.gitignore` 中排除，
**更新只替换代码，不会覆盖你网站上的任何内容**。

### 方式二：宝塔面板部署

见 **[docs/宝塔部署.md](docs/宝塔部署.md)** —— 从装 Node 到 HTTPS、备份、更新的完整步骤。

要点先说三条：

1. **Node.js 必须 ≥ 22.13.0**（推荐 24 LTS）。本项目用 Node 内置的 `node:sqlite`，
   22.5~22.12 需要额外标志才能用；项目已内置版本自检，版本不对会给出中文提示。
2. 进程守护用 PM2，项目已附带 `ecosystem.config.js`：
   ```bash
   npm install --omit=dev
   pm2 start ecosystem.config.js && pm2 save
   ```
3. 用宝塔的**反向代理**指到 `http://127.0.0.1:3000`，
   **不要**把站点根目录指向项目目录（静态资源由 Node 自己提供）。

### 健康检查

```bash
curl http://127.0.0.1:3000/healthz
# {"ok":true,"status":"healthy",...}
```

可用作宝塔/PM2/负载均衡的探活地址；数据库不可用时返回 503。

---

## 五、目录结构

```
├── server/                  后端（Express + node:sqlite）
│   ├── index.js             服务入口：安全头、静态资源、路由挂载、错误处理
│   ├── db.js                数据层：表结构、迁移、设置读写、审计
│   ├── auth.js              鉴权：scrypt 哈希、会话、RBAC 权限矩阵
│   ├── seed.js              种子数据（幂等）
│   ├── render.js            模板层：布局壳、转义、图标、页头页脚
│   ├── admin-ui.js          后台界面层：资源定义驱动的列表 / 表单渲染
│   └── routes/
│       ├── site.js          前台：首页、工坊、项目详情、公告详情、留言
│       └── admin.js         后台：页面 + 内容/OA/媒体/设置 API
├── public/                  前端（零构建，原生多页）
│   ├── assets/css/          base（设计系统）· portal（橙色门户）· atelier（米白工坊）· admin
│   ├── assets/js/app.js     交互：进站动效、滚动显现、弹窗、AJAX 表单
│   ├── assets/brand/        品牌标识
│   ├── assets/img/          配图
│   └── uploads/             后台上传的文件
├── tools/
│   ├── generate_assets.py   配图生成器（Pillow）
│   ├── smoke.js             端到端自检（87 项）
│   ├── pages-test.js        自建页面自检（56 项）
│   ├── md-test.js           Markdown 渲染器自检（61 项）
│   ├── sanitize-test.js     HTML 清洗器自检（58 项）
│   ├── screenshots.js       截图验收（CDP 驱动）
│   ├── layout-check.js      响应式横向溢出体检
│   └── display-check.js     布局体检（inline + 背景类问题）
├── data/                    SQLite 数据库（自动创建）
├── Dockerfile
├── docker-compose.yml
├── start.bat / start.sh
└── PRAX.png                 官方 logo（配图生成的输入）
```

### 页面编辑器相关文件

```
server/markdown.js           Markdown 渲染器（零依赖，全转义）
server/content.js            正文渲染入口 + HTML 白名单清洗器
server/page-editor.js        编辑器界面（工具栏 / 预览 / 历史版本）
public/assets/js/page-editor.js   编辑器前端交互（实时预览、快捷键）
public/assets/css/editor.css      编辑器样式
public/assets/css/pages.css       自建页面的前台排版
```

---

## 六、自检与验收

```bash
npm start                    # 另开一个终端保持服务运行

node tools/smoke.js          # 端到端：87 项（页面、鉴权、CRUD、开关联动、权限、上传、XSS）
node tools/pages-test.js     # 自建页面：56 项（两种格式、导航联动、版本回滚、权限、清洗）
node tools/md-test.js        # Markdown 渲染：61 项（语法正确性 + 安全边界）
node tools/sanitize-test.js  # HTML 清洗：58 项（必须拦掉的 / 必须保留的）
node tools/screenshots.js --admin   # 截图到 shots/
node tools/layout-check.js   # 8 个页面 × 6 种视口宽度，检测横向溢出与控制台报错
node tools/display-check.js  # 检测"inline 元素带背景"这类布局缺陷
```

合计 **262 项自动化检查**。

`smoke.js` 覆盖：公开页面可达性与内容、登录成败、未登录写接口被拒、
后台页面可访问、内容增删改查与前台联动、
**六个首页开关逐个验证「开启时出现 / 关闭时消失」**（含留言接口的开关联动）、
OA 任务流转与审批决策、审计日志落库、角色权限隔离、图片上传与删除、XSS 转义。

`pages-test.js` 覆盖：Seed 页面渲染、Markdown/HTML 两种格式的创建与编辑、
**路径稳定性**（改标题不改 URL）、导航联动、可见性开关、历史版本与回滚、
预览接口、权限隔离、以及与项目路由共存。

> 这套脚本是用来防回归的。开发过程中被抓出来的真实缺陷包括：
> 后台有开关但前台根本没读（装饰性设置）；
> 看板卡片因 `<a>` 默认 `inline` 导致背景只画成窄带；
> `[hidden]` 被 `display:grid` 盖掉导致空状态常驻；
> 以及 **PATCH 语义错误** —— 请求里没带的字段被重置为 0，
> 于是「只改正文」会把页面 `visible` 刷成 0、并且顺手改掉 URL。
> 这些都是靠上面这些脚本发现的，不是靠肉眼。

---

## 七、技术说明

- **为什么用 `node:sqlite`**：Node 22.13+ 内置，无需 `better-sqlite3` 之类的原生编译，
  换机器、上容器、装宝塔都不用重装工具链。
  （22.5~22.12 虽然也有该模块，但需要 `--experimental-sqlite` 标志，故最低要求定在 22.13。）
- **为什么不用前端框架**：门户与后台都是内容型页面，服务端渲染 + 少量原生 JS
  已经够用，且部署时不需要构建步骤，改完刷新即可。
- **安全性**：scrypt 口令哈希、HttpOnly 会话 Cookie、CSP 与若干安全响应头、
  字段白名单写入（未知字段直接忽略）、上传类型白名单 + 随机文件名、
  所有用户内容输出前转义。
- **自建页面的安全模型**：Markdown 走"先转义、再套格式"，正文里的 HTML
  永远只是文字；HTML 模式走"标签/属性双白名单 + 逐标签重写"清洗，
  且写入需要内容权限并记审计日志。**安全过滤集中在 `content.js` 的
  `sanitizeHtml` 单入口**——`<style>` 内容过滤也包含在内，
  避免"某个调用方忘了调第二个函数"就出现漏洞面。
- **PATCH 语义**：更新接口只改请求里**实际出现**的字段。
  `pages` 与通用资源 CRUD 都遵循这一约定，避免"只改一个字段"
  把其余字段静默重置成默认值。

---

## 八、常见问题

**端口被占用？**

```bash
PORT=3001 npm start          # Linux / macOS
set PORT=3001 && npm start   # Windows CMD
$env:PORT=3001; npm start    # Windows PowerShell
```

**自建页面的路径冲突了怎么办？**
项目与自建页面共用 `/p/<路径>` 前缀，**项目优先**匹配，
所以已有的项目链接不会因为新增页面而失效。
如果自建页面的路径与某个项目重名，改一下页面路径即可。

**想重置数据？**

```bash
# 停掉服务，删除数据库文件后重新初始化
rm data/prax.sqlite*         # Windows: del data\prax.sqlite*
npm run seed
```

**改了 `PRAX.png` 想更新配图？**

```bash
npm run images               # 需要 Python 3 与 Pillow
```
