'use strict';
/**
 * 前台路由：门户首页 / 工坊子页面 / 项目详情 / 公告详情
 */

const express = require('express');
const { all, get, getSettings, parseJSON, toBool } = require('../db');
const R = require('../render');
const { clientIp } = require('../auth');

const router = express.Router();

/* ---------------------------------------------------------------- 数据组装 */

function shuffleByOrder(list) {
  return list.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

function shapeProject(p) {
  const tags = parseJSON(p.tags, []);
  return Object.assign({}, p, {
    tags: Array.isArray(tags) ? tags : [],
    featured: toBool(p.featured),
    visible: toBool(p.visible),
  });
}

function shapeShowcase(s) {
  const tags = parseJSON(s.tags, []);
  return Object.assign({}, s, {
    tags: Array.isArray(tags) ? tags : [],
    featured: toBool(s.featured),
    visible: toBool(s.visible),
  });
}

function loadNav() {
  const items = all('SELECT * FROM nav_items WHERE visible = 1 ORDER BY sort_order, id').map((n) =>
    Object.assign({}, n, { visible: toBool(n.visible) })
  );
  // 自建页面勾选了「加入导航」的，自动追加到页头导航
  const pageNav = all(
    'SELECT title, slug, nav_label, sort_order FROM pages WHERE visible = 1 AND in_nav = 1 ORDER BY sort_order, id'
  ).map((p) => ({
    label: p.nav_label || p.title,
    href: '/p/' + p.slug,
    target: '_self',
    sort_order: p.sort_order,
    visible: true,
    fromPage: true,
  }));

  // 去重：手工导航项与自建页面可能指向同一地址或同名，
  // 页头出现两个「关于」是很显眼的缺陷，这里按 href 与名称各去一次。
  const seenHref = new Set();
  const seenLabel = new Set();
  return items
    .concat(pageNav)
    .filter((n) => {
      const href = String(n.href || '').trim();
      const label = String(n.label || '').trim();
      if (seenHref.has(href) || (label && seenLabel.has(label))) return false;
      seenHref.add(href);
      if (label) seenLabel.add(label);
      return true;
    })
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

function loadFriends() {
  return all('SELECT * FROM friends WHERE visible = 1 ORDER BY sort_order, id').map((f) =>
    Object.assign({}, f, { visible: toBool(f.visible) })
  );
}

function publicProjects({ featuredOnly = false, limit = 0 } = {}) {
  let sql = 'SELECT * FROM projects WHERE visible = 1';
  if (featuredOnly) sql += ' AND featured = 1';
  sql += ' ORDER BY sort_order, id';
  if (limit > 0) sql += ` LIMIT ${Number(limit)}`;
  return all(sql).map(shapeProject);
}

function publicShowcases() {
  return all('SELECT * FROM showcases WHERE visible = 1 ORDER BY sort_order, id').map(shapeShowcase);
}

function publicAnnouncements(limit = 0) {
  let sql = 'SELECT * FROM announcements WHERE visible = 1 ORDER BY pinned DESC, published_at DESC, id DESC';
  if (limit > 0) sql += ` LIMIT ${Number(limit)}`;
  return all(sql).map((a) => Object.assign({}, a, { pinned: toBool(a.pinned), visible: toBool(a.visible) }));
}

/** 分类中文名 */
const PROJECT_CAT = {
  platform: '平台',
  plugin: '插件',
  design: '设计',
  project: '项目',
  tool: '工具',
};

const SHOWCASE_CAT = {
  side: '设计副产品',
  linked: '联动内容',
  experiment: '实验尝试',
};

/* ---------------------------------------------------------------- 首页 */

router.get('/', (req, res) => {
  const s = getSettings();
  const nav = loadNav();
  const friends = loadFriends();
  const projects = publicProjects();
  const featured = projects.filter((p) => p.featured);
  const showcases = publicShowcases();
  const announcements = publicAnnouncements(3);

  const metrics = [
    { num: String(projects.length).padStart(2, '0'), label: '项目线' },
    { num: String(showcases.length).padStart(2, '0'), label: '工坊产出' },
    { num: friends.length ? String(friends.length).padStart(2, '0') : '00', label: '友情链接' },
  ];

  const projCards = (projects.length ? projects : [])
    .map(
      (p) => `<article class="proj reveal" data-cat="${R.escAttr(p.category)}">
  <a class="proj__cover" href="${R.escAttr(p.link_url || '/p/' + p.slug)}"${
        /^https?:/i.test(p.link_url || '') ? ' target="_blank" rel="noopener"' : ''
      } aria-label="${R.escAttr(p.title)}">
    ${
      p.cover
        ? `<img src="${R.escAttr(p.cover)}" alt="${R.escAttr(p.title)} 封面" loading="lazy" decoding="async">`
        : ''
    }
    <span class="proj__cat">${R.esc(PROJECT_CAT[p.category] || p.category)}</span>
    ${p.featured ? `<span class="proj__feat">${R.icon('sparkle', 13)}精选</span>` : ''}
  </a>
  <div class="proj__body">
    ${p.subtitle ? `<div class="proj__sub">${R.esc(p.subtitle)}</div>` : ''}
    <h3 class="proj__title">${R.esc(p.title)}</h3>
    <p class="proj__summary">${R.esc(R.truncate(p.summary, 86))}</p>
    ${
      p.tags.length
        ? `<div class="proj__tags">${p.tags
            .slice(0, 4)
            .map((t) => `<span class="tag">${R.esc(t)}</span>`)
            .join('')}</div>`
        : ''
    }
    <div class="proj__foot">
      ${
        p.link_url
          ? `<a class="proj__link" href="${R.escAttr(p.link_url)}"${
              /^https?:/i.test(p.link_url) ? ' target="_blank" rel="noopener"' : ''
            }>${R.esc(p.link_label || '前往查看')}${R.icon('arrowRight', 15)}</a>`
          : `<a class="proj__link" href="/p/${R.escAttr(p.slug)}">了解详情${R.icon('arrowRight', 15)}</a>`
      }
      ${
        p.repo_url
          ? `<a class="proj__repo" href="${R.escAttr(p.repo_url)}" target="_blank" rel="noopener">${R.icon(
              'link',
              12
            )}仓库</a>`
          : ''
      }
    </div>
  </div>
</article>`
    )
    .join('');

  const newsRows = announcements
    .map((a) => {
      const d = R.fmtDate(a.published_at);
      const parts = d.split('-');
      return `<a class="news reveal" href="/n/${a.id}">
  <div class="news__date"><b>${R.esc(parts[2] || '')}</b><i>${R.esc(parts[0] + '.' + (parts[1] || ''))}</i></div>
  <div class="news__body">
    <div class="news__title">${a.pinned ? `<span class="pin">置顶</span>` : ''}${R.esc(a.title)}</div>
    <p class="news__summary">${R.esc(R.truncate(a.summary, 96))}</p>
  </div>
</a>`;
    })
    .join('');

  const friendCards = friends
    .map((f) => {
      const initial = (f.name || '?').replace(/^(Gitee|GitHub)\s*·\s*/i, '').trim().charAt(0) || 'P';
      return `<a class="friend reveal" href="${R.escAttr(f.url)}" target="_blank" rel="noopener">
  <span class="friend__ico">${R.esc(initial.toUpperCase())}</span>
  <span>
    <span class="friend__name">${R.esc(f.name)}</span>
    <span class="friend__desc">${R.esc(f.description || '')}</span>
  </span>
  <span class="friend__go">${R.icon('external', 18)}</span>
</a>`;
    })
    .join('');

  const showProjects = toBool(s.show_projects);
  const showStrip = toBool(s.show_showcase_strip);
  const showFriends = toBool(s.show_friends);
  const showNews = toBool(s.show_announcements);
  const showContact = toBool(s.enable_contact_form);
  const showOaEntry = toBool(s.show_oa_entry);

  const body = `
${R.siteHeader({ settings: s, user: req.user, navItems: nav, active: '/' })}

<main id="main">
  <!-- 首屏 -->
  <section class="hero">
    <div class="hero__bg">
      <img src="/assets/img/hero-portal.jpg" alt="" fetchpriority="high" decoding="async">
    </div>
    <img class="hero__wheel" src="/assets/pattern/citrus-wheel.svg" alt="" aria-hidden="true">
    <div class="wrap hero__in">
      <div>
        <div class="hero__badge reveal"><b>P</b><span>${R.esc(s.site_name_en || '')} · ${R.esc(
    s.site_abbr || 'Prax'
  )}</span></div>
        <h1 class="reveal" style="--reveal-delay:80ms">
          <span class="grad">${R.esc(s.site_name || '橙曦澎湃')}</span>
          <span class="thin">${R.esc(s.site_tagline || '')}</span>
        </h1>
        <p class="hero__lead reveal" style="--reveal-delay:160ms">${R.esc(s.site_description || '')}</p>
        <div class="hero__cta reveal" style="--reveal-delay:240ms">
          ${
            showProjects
              ? `<a class="btn btn-primary btn-lg" href="#projects">${R.icon('grid', 18)}浏览项目</a>`
              : ''
          }
          <a class="btn btn-${showProjects ? 'ghost' : 'primary'} btn-lg" href="/atelier">${R.icon(
    'palette',
    18
  )}进入${R.esc(s.subpage_name || '工坊')}</a>
        </div>
      </div>
      <aside class="hero__side">
        ${metrics
          .map(
            (m, i) => `<div class="metric reveal" style="--reveal-delay:${320 + i * 90}ms">
          <div class="metric__num">${R.esc(m.num)}</div>
          <div class="metric__label">${R.esc(m.label)}</div>
        </div>`
          )
          .join('')}
      </aside>
    </div>
    <div class="hero__scroll"><span>Scroll</span><i></i></div>
  </section>

  <!-- 项目 -->
  ${
    showProjects
      ? `<section class="section" id="projects">
    <div class="wrap">
      <div class="sec-head reveal">
        <div>
          <span class="eyebrow">Projects</span>
          <h2>项目线</h2>
          <p>每条项目线都有独立的定位与交付物。链接指向与首页展示状态均由后台维护。</p>
        </div>
        <span class="muted">共 ${projects.length} 项</span>
      </div>
      ${
        projCards
          ? `<div class="proj-grid">${projCards}</div>`
          : `<div class="empty">${R.icon('box', 34)}<p>项目正在整理中。</p></div>`
      }
    </div>
  </section>`
      : ''
  }
  ${
    showStrip
      ? `
  <!-- 工坊导流 -->
  <section class="section-sm">
    <div class="wrap">
      <div class="atelier-strip reveal">
        <div class="atelier-strip__bg"><img src="/assets/img/subpage-hero.jpg" alt="" loading="lazy"></div>
        <div class="atelier-strip__in">
          <div class="atelier-strip__text">
            <span class="eyebrow">${R.esc(s.subpage_name_en || 'Atelier')}</span>
            <h2>${R.esc(s.subpage_name || '橙曦工坊')}</h2>
            <p>${R.esc(s.subpage_intro || '')}</p>
            <div class="atelier-strip__pills">
              <span class="pill">设计副产品</span>
              <span class="pill">联动内容</span>
              <span class="pill">实验尝试</span>
            </div>
          </div>
          <a class="btn btn-accent btn-lg" href="/atelier">进入${R.esc(s.subpage_name || '工坊')}${R.icon(
              'arrowRight',
              18
            )}</a>
        </div>
      </div>
    </div>
  </section>`
      : ''
  }
  ${
    showNews
      ? `
  <!-- 公告 -->
  <section class="section sec-alt" id="news">
    <div class="wrap">
      <div class="sec-head reveal">
        <div>
          <span class="eyebrow">News</span>
          <h2>动态与公告</h2>
          <p>记录每一次上线与调整。</p>
        </div>
      </div>
      ${
        newsRows
          ? `<div class="news-list">${newsRows}</div>`
          : `<div class="empty">${R.icon('megaphone', 34)}<p>暂无公告。</p></div>`
      }
    </div>
  </section>`
      : ''
  }
  ${
    showFriends
      ? `
  <!-- 友情链接 -->
  <section class="section" id="friends">
    <div class="wrap">
      <div class="sec-head reveal">
        <div>
          <span class="eyebrow">Friends</span>
          <h2>友情链接</h2>
          <p>常去的地方。</p>
        </div>
      </div>
      ${
        friendCards
          ? `<div class="friend-grid">${friendCards}</div>`
          : `<div class="empty">${R.icon('link', 34)}<p>暂无友情链接。</p></div>`
      }
    </div>
  </section>`
      : ''
  }

  <!-- 关于 -->
  <section class="section sec-alt" id="about">
    <div class="wrap about-grid">
      <div class="reveal">
        <span class="eyebrow">About</span>
        <h2 style="font-size:clamp(26px,3.4vw,40px);margin:14px 0 18px">关于 ${R.esc(
          s.site_name || '橙曦澎湃'
        )}</h2>
        <p class="lead">${R.esc(s.site_description || '')}</p>
        <p class="lead">我们关心的是「东西能不能真的用起来」：把想法做成可维护的项目，把项目做成可交付的成果，再把成果整理成可以被别人复用的形式。</p>
        <div class="hero__cta" style="margin-top:26px">
          <a class="btn btn-primary" href="/atelier">${R.icon('palette', 17)}看看${R.esc(
            s.subpage_name || '工坊'
          )}</a>
          ${
            showOaEntry
              ? `<a class="btn btn-ghost" href="/admin/login">${R.icon('shield', 17)}协同后台</a>`
              : ''
          }
        </div>
      </div>
      <div class="about-facts reveal" style="--reveal-delay:120ms">
        <div class="fact">${R.icon('target', 20)}<span><b>我们在做什么</b><span>插件开发、工具链建设与设计实践，三个方向互相支撑。</span></span></div>
        <div class="fact">${R.icon('bolt', 20)}<span><b>怎么做事</b><span>先跑通最小闭环，再补细节；每次改动都可回退。</span></span></div>
        <div class="fact">${R.icon('palette', 20)}<span><b>视觉怎么做</b><span>只用品牌三色：橙红、明黄、米白，取自官方标识。</span></span></div>
        <div class="fact">${R.icon('users', 20)}<span><b>协同怎么走</b><span>项目、任务、审批与公告集中在协同后台，链接与展示状态可配。</span></span></div>
      </div>
    </div>
  </section>
  ${
    showContact
      ? `
  <!-- 联系 -->
  <section class="section" id="contact">
    <div class="wrap contact-grid">
      <div class="reveal">
        <span class="eyebrow">Contact</span>
        <h2 style="font-size:clamp(24px,3vw,36px);margin:14px 0 16px">联系我们</h2>
        <p class="lead">有合作意向、想聊技术，或者发现了问题，都可以直接留言。</p>
        <div class="about-facts" style="margin-top:24px">
          <div class="fact">${R.icon('mail', 19)}<span><b>邮箱</b><span>${R.esc(
              s.contact_email || '—'
            )}</span></span></div>
          <div class="fact">${R.icon('link', 19)}<span><b>代码托管</b><span>${
              friends.length ? R.esc(friends.map((f) => f.name).join(' · ')) : '—'
            }</span></span></div>
        </div>
      </div>
      <form class="contact-form reveal" id="contactForm" style="--reveal-delay:120ms">
        <div class="grid-2">
          <div class="field">
            <label for="cf-name">称呼</label>
            <input class="input" id="cf-name" name="name" required maxlength="60" placeholder="怎么称呼你">
          </div>
          <div class="field">
            <label for="cf-contact">联系方式</label>
            <input class="input" id="cf-contact" name="contact" maxlength="120" placeholder="邮箱 / 其他">
          </div>
        </div>
        <div class="field">
          <label for="cf-subject">主题</label>
          <input class="input" id="cf-subject" name="subject" maxlength="120" placeholder="想聊点什么">
        </div>
        <div class="field">
          <label for="cf-body">内容</label>
          <textarea class="textarea" id="cf-body" name="body" required maxlength="2000" placeholder="详细说明…"></textarea>
        </div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">${R.icon('mail', 18)}发送留言</button>
      </form>
    </div>
  </section>`
      : ''
  }
</main>

${R.siteFooter({ settings: s, navItems: nav, friends, subpage: s.subpage_name })}
`;

  res.send(
    R.layout({
      page: 'portal',
      bodyClass: 'page-portal',
      title: '',
      description: s.site_description,
      styles: ['/assets/css/portal.css'],
      settings: s,
      user: req.user,
      body,
    })
  );
});

/* ---------------------------------------------------------------- 子页面 */

router.get('/atelier', (req, res) => {
  const s = getSettings();
  const nav = loadNav();
  const friends = loadFriends();
  const items = publicShowcases();

  // 分类统计（只统计实际存在的分类）
  const counts = { all: items.length, side: 0, linked: 0, experiment: 0 };
  items.forEach((i) => {
    if (counts[i.category] !== undefined) counts[i.category]++;
  });

  const cats = [
    { key: 'all', label: '全部' },
    { key: 'side', label: '设计副产品' },
    { key: 'linked', label: '联动内容' },
    { key: 'experiment', label: '实验尝试' },
  ].filter((c) => c.key === 'all' || counts[c.key] > 0);

  const featured = items.filter((i) => i.featured);
  const hero = featured[0] || items[0] || null;

  const chips = cats
    .map(
      (c) =>
        `<button class="chip${c.key === 'all' ? ' is-active' : ''}" data-cat="${R.escAttr(c.key)}" type="button">` +
        `${R.esc(c.label)}<span class="chip__n">${counts[c.key] || 0}</span></button>`
    )
    .join('');

  const workCards = items
    .map((w) => {
      const json = R.escAttr(
        JSON.stringify({
          title: w.title,
          subtitle: w.subtitle,
          year: w.year,
          credit: w.credit,
          cover: w.cover,
          tags: w.tags,
          linkUrl: w.link_url,
          bodyHtml: R.nl2p(w.body || w.summary),
        })
      );
      return `<article class="work reveal" data-work-cat="${R.escAttr(w.category)}">
  <div class="work__cover">
    ${
      w.cover
        ? `<img src="${R.escAttr(w.cover)}" alt="${R.escAttr(w.title)} 封面" loading="lazy" decoding="async">`
        : ''
    }
    <div class="work__badges">
      <span class="work__kind${w.category === 'linked' ? ' is-linked' : ''}">${R.icon(
        w.category === 'linked' ? 'link' : 'sparkle',
        12
      )}${R.esc(SHOWCASE_CAT[w.category] || w.category)}</span>
    </div>
    ${w.year ? `<span class="work__year">${R.esc(w.year)}</span>` : ''}
  </div>
  <div class="work__body">
    ${w.subtitle ? `<div class="work__sub">${R.esc(w.subtitle)}</div>` : ''}
    <h3 class="work__title">${R.esc(w.title)}</h3>
    <p class="work__summary">${R.esc(R.truncate(w.summary, 80))}</p>
    ${
      w.tags.length
        ? `<div class="work__tags">${w.tags
            .slice(0, 4)
            .map((t) => `<span class="tag">${R.esc(t)}</span>`)
            .join('')}</div>`
        : ''
    }
    <div class="work__foot">
      <span class="work__credit">${R.icon('file', 13)}${R.esc(w.credit || '—')}</span>
      <button class="work__more" type="button" data-work-open data-work-json="${json}">查看详情${R.icon(
        'arrowRight',
        14
      )}</button>
    </div>
  </div>
</article>`;
    })
    .join('');

  const linkedCards = items
    .filter((i) => i.category === 'linked')
    .map(
      (i) => `<div class="at-link reveal">
  <div class="at-link__ico">${R.icon('link', 22)}</div>
  <h3>${R.esc(i.title)}</h3>
  <p>${R.esc(R.truncate(i.summary, 76))}</p>
  ${
    i.link_url
      ? `<a href="${R.escAttr(i.link_url)}"${/^https?:/i.test(i.link_url) ? ' target="_blank" rel="noopener"' : ''}>前往查看${R.icon('arrowRight', 14)}</a>`
      : `<a href="/atelier">继续浏览${R.icon('arrowRight', 14)}</a>`
  }
</div>`
    )
    .join('');

  const body = `
${R.siteHeader({ settings: s, user: req.user, navItems: nav, active: '/atelier' })}

<main id="main">
  <section class="at-hero">
    <div class="at-hero__bg"><img src="/assets/img/subpage-hero.jpg" alt="" fetchpriority="high"></div>
    <div class="wrap">
      <div class="at-hero__in">
        <div class="at-hero__en reveal">${R.esc(s.subpage_name_en || 'Prax Atelier')}</div>
        <h1 class="reveal" style="--reveal-delay:60ms">${R.esc(s.subpage_name || '橙曦工坊')}<br><em>${
    s.subpage_tagline ? R.esc(s.subpage_tagline) : '设计作业的副产品与联动内容'
  }</em></h1>
        <p class="at-hero__lead reveal" style="--reveal-delay:120ms">${R.esc(s.subpage_intro || '')}</p>
        <div class="hero__cta reveal" style="--reveal-delay:180ms">
          <a class="btn btn-primary" href="#works">${R.icon('grid', 17)}浏览作品</a>
          <a class="btn btn-ghost" href="/">${R.icon('home', 17)}返回门户</a>
        </div>
        <div class="at-stats reveal" style="--reveal-delay:240ms">
          <div class="at-stat"><b>${String(items.length).padStart(2, '0')}</b><span>收录作品</span></div>
          <div class="at-stat"><b>${String(counts.linked || 0).padStart(2, '0')}</b><span>联动内容</span></div>
          <div class="at-stat"><b>${String(featured.length).padStart(2, '0')}</b><span>精选</span></div>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="works">
    <div class="wrap">
      <div class="sec-head reveal">
        <div>
          <span class="eyebrow">Works</span>
          <h2>作品与副产品</h2>
          <p>${R.esc(s.subpage_intro || '')}</p>
        </div>
      </div>

      ${
        hero
          ? `<div class="at-feature reveal">
        <div class="at-feature__cover">${
          hero.cover ? `<img src="${R.escAttr(hero.cover)}" alt="${R.escAttr(hero.title)}" loading="lazy">` : ''
        }</div>
        <div class="at-feature__body">
          <span class="eyebrow">Featured</span>
          <h2>${R.esc(hero.title)}</h2>
          <p>${R.esc(hero.summary)}</p>
          <div class="work__tags">${hero.tags
            .map((t) => `<span class="tag">${R.esc(t)}</span>`)
            .join('')}</div>
          <div class="hero__cta" style="margin-top:8px">
            <button class="btn btn-primary" type="button" data-work-open data-work-json="${R.escAttr(
              JSON.stringify({
                title: hero.title,
                subtitle: hero.subtitle,
                year: hero.year,
                credit: hero.credit,
                cover: hero.cover,
                tags: hero.tags,
                linkUrl: hero.link_url,
                bodyHtml: R.nl2p(hero.body || hero.summary),
              })
            )}">查看详情${R.icon('arrowRight', 16)}</button>
            ${
              hero.link_url
                ? `<a class="btn btn-ghost" href="${R.escAttr(hero.link_url)}"${
                    /^https?:/i.test(hero.link_url) ? ' target="_blank" rel="noopener"' : ''
                  }>${R.icon('external', 16)}前往</a>`
                : ''
            }
          </div>
        </div>
      </div>`
          : ''
      }

      <div class="at-filter" id="atFilter">${chips}</div>

      ${
        workCards
          ? `<div class="at-grid">${workCards}</div>
             <div class="empty" id="atEmpty" hidden>${R.icon('search', 32)}<p>该分类下暂无内容。</p></div>`
          : `<div class="empty">${R.icon('box', 34)}<p>内容正在整理中。</p></div>`
      }
    </div>
  </section>
  ${
    linkedCards
      ? `
  <section class="section sec-alt">
    <div class="wrap">
      <div class="sec-head reveal">
        <div>
          <span class="eyebrow">Cross-over</span>
          <h2>联动内容</h2>
          <p>与主线项目彼此关联的部分，点击可以直接跳到对应位置。</p>
        </div>
      </div>
      <div class="at-link-grid">${linkedCards}</div>
    </div>
  </section>`
      : ''
  }

  <section class="section">
    <div class="wrap-narrow">
      <div class="at-note reveal">
        ${R.icon('sparkle', 22)}
        <div>
          <b>关于这里的内容</b>
          <p>本页收录的多为设计作业延伸出来的副产品与实验性尝试。它们未必都成熟，但都完整做过一遍：从想法、到实现、再到能被别人看到的样子。</p>
        </div>
      </div>
      <div class="hero__cta" style="margin-top:28px;justify-content:center">
        <a class="btn btn-primary btn-lg" href="/">${R.icon('home', 18)}返回门户首页</a>
        <a class="btn btn-ghost btn-lg" href="/#projects">${R.icon('grid', 18)}看看项目线</a>
      </div>
    </div>
  </section>
</main>

<div class="modal" id="workModal" role="dialog" aria-modal="true" aria-labelledby="workModalTitle">
  <div class="modal__veil" data-modal-close></div>
  <div class="modal__panel modal-lg">
    <div class="modal__head">
      <h3 id="workModalTitle">作品详情</h3>
      <button class="modal__x" type="button" data-modal-close aria-label="关闭">${R.icon('close', 18)}</button>
    </div>
    <div class="modal__body">
      <div class="at-detail">
        <div class="at-detail__cover"><img id="workModalCover" src="" alt=""></div>
        <div class="at-detail__meta"><span id="workModalSub"></span></div>
        <div class="prose" id="workModalBody"></div>
        <div class="work__tags" id="workModalTags"></div>
      </div>
    </div>
    <div class="modal__foot">
      <a class="btn btn-primary" id="workModalLink" href="#" target="_blank" rel="noopener" hidden>${R.icon(
        'external',
        16
      )}前往查看</a>
      <button class="btn btn-ghost" type="button" data-modal-close>关闭</button>
    </div>
  </div>
</div>

${R.siteFooter({ settings: s, navItems: nav, friends, subpage: s.subpage_name })}
`;

  res.send(
    R.layout({
      page: 'atelier',
      bodyClass: 'page-atelier',
      title: s.subpage_name || '橙曦工坊',
      description: s.subpage_intro || '',
      styles: ['/assets/css/atelier.css'],
      settings: s,
      user: req.user,
      body,
    })
  );
});

/* ---------------------------------------------------------------- 项目详情 */

router.get('/p/:slug', (req, res, next) => {
  const p = get('SELECT * FROM projects WHERE slug = ? AND visible = 1', req.params.slug);
  if (!p) return next();

  const s = getSettings();
  const nav = loadNav();
  const friends = loadFriends();
  const proj = shapeProject(p);
  const related = publicProjects().filter((x) => x.id !== proj.id).slice(0, 3);

  const body = `
${R.siteHeader({ settings: s, user: req.user, navItems: nav })}
<main id="main" class="section" style="padding-top:calc(var(--header-h) + 60px)">
  <div class="wrap-narrow proj-detail">
    <a class="btn btn-ghost btn-sm" href="/" style="margin-bottom:24px">${R.icon('arrowRight', 15)}返回门户</a>
    <div class="proj-detail__head">
      <span class="eyebrow">${R.esc(PROJECT_CAT[proj.category] || proj.category)}</span>
      <h1>${R.esc(proj.title)}</h1>
      ${proj.subtitle ? `<p class="proj-detail__sub">${R.esc(proj.subtitle)}</p>` : ''}
    </div>
    ${
      proj.cover
        ? `<div class="proj-detail__cover">
             <img src="${R.escAttr(proj.cover)}" alt="${R.escAttr(proj.title)}"></div>`
        : ''
    }
    <p class="proj-detail__summary">${R.esc(proj.summary)}</p>
    <div class="prose proj-detail__body">${R.nl2p(proj.body)}</div>
    <div class="proj__tags proj-detail__tags">${proj.tags
      .map((t) => `<span class="tag">${R.esc(t)}</span>`)
      .join('')}</div>
    <div class="hero__cta proj-detail__cta">
      ${
        proj.link_url
          ? `<a class="btn btn-primary" href="${R.escAttr(proj.link_url)}"${
              /^https?:/i.test(proj.link_url) ? ' target="_blank" rel="noopener"' : ''
            }>${R.icon('external', 17)}${R.esc(proj.link_label || '前往查看')}</a>`
          : ''
      }
      ${
        proj.repo_url
          ? `<a class="btn btn-ghost" href="${R.escAttr(proj.repo_url)}" target="_blank" rel="noopener">${R.icon(
              'link',
              17
            )}代码仓库</a>`
          : ''
      }
    </div>
    ${
      related.length
        ? `<div class="divider" style="margin:48px 0 32px"></div>
           <h3 class="proj-detail__related-title">其他项目</h3>
           <div class="proj__tags proj-detail__tags" style="gap:10px">${related
             .map((x) => `<a class="tag" href="/p/${R.escAttr(x.slug)}">${R.esc(x.title)}</a>`)
             .join('')}</div>`
        : ''
    }
  </div>
</main>
${R.siteFooter({ settings: s, navItems: nav, friends, subpage: s.subpage_name })}
`;

  res.send(
    R.layout({
      page: 'portal',
      bodyClass: 'page-portal',
      title: proj.title,
      description: proj.summary,
      ogImage: proj.cover || undefined,
      styles: ['/assets/css/portal.css'],
      settings: s,
      user: req.user,
      body,
    })
  );
});

/* ---------------------------------------------------------------- 自建页面
 *
 * 与项目共用 /p/:slug 前缀。项目先匹配（上面那条），
 * 项目里没有这个 slug 时才落到这里找自建页面 —— 这样已有项目链接不会失效。
 */

const content = require('../content');

router.get('/p/:slug', (req, res, next) => {
  const page = get('SELECT * FROM pages WHERE slug = ? AND visible = 1', req.params.slug);
  if (!page) return next();

  const s = getSettings();
  const nav = loadNav();
  const friends = loadFriends();
  const layout = ['plain', 'portal', 'cream'].includes(page.layout) ? page.layout : 'cream';
  const html = content.renderBody(page.body, page.format);

  const isPlain = layout === 'plain';
  const isPortal = layout === 'portal';
  const bodyClass = isPortal ? 'page-portal' : 'page-atelier';
  const styles = isPortal ? ['/assets/css/portal.css'] : ['/assets/css/atelier.css', '/assets/css/pages.css'];

  const showHeader = toBool(page.show_header) && !isPlain;
  const showFooter = toBool(page.show_footer) && !isPlain;

  const main = `
${showHeader ? R.siteHeader({ settings: s, user: req.user, navItems: nav }) : ''}
<main id="main" class="custom-page${isPlain ? ' custom-page--plain' : ''}">
  ${
    page.cover
      ? `<div class="custom-cover"><img src="${R.escAttr(page.cover)}" alt="${R.escAttr(page.title)}"></div>`
      : ''
  }
  <div class="wrap">
    <article class="custom-article">
      <header class="custom-head">
        <h1 class="custom-title">${R.esc(page.title)}</h1>
        ${
          page.summary
            ? `<p class="custom-summary">${R.esc(page.summary)}</p>`
            : ''
        }
        <div class="custom-meta">
          <span>${R.fmtDate(page.updated_at)} 更新</span>
          ${
            page.format === 'html'
              ? '<span class="fmt-badge fmt-html">HTML</span>'
              : '<span class="fmt-badge fmt-markdown">Markdown</span>'
          }
        </div>
      </header>
      <div class="prose custom-body">
        ${html || '<p class="muted">这个页面还没有内容。</p>'}
      </div>
    </article>
  </div>
</main>
${showFooter ? R.siteFooter({ settings: s, navItems: nav, friends, subpage: s.subpage_name }) : ''}
`;

  res.send(
    R.layout({
      page: 'custom',
      bodyClass,
      title: page.title,
      description: page.summary || s.site_description,
      ogImage: page.cover || undefined,
      styles,
      settings: s,
      user: req.user,
      body: main,
      noPreload: true,
    })
  );
});

/* ---------------------------------------------------------------- 公告详情 */

router.get('/n/:id', (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next();
  const a = get('SELECT * FROM announcements WHERE id = ? AND visible = 1', id);
  if (!a) return next();

  const s = getSettings();
  const nav = loadNav();
  const friends = loadFriends();

  const body = `
${R.siteHeader({ settings: s, user: req.user, navItems: nav })}
<main id="main" class="section" style="padding-top:calc(var(--header-h) + 60px)">
  <div class="wrap-narrow news-detail">
    <a class="btn btn-ghost btn-sm" href="/#news" style="margin-bottom:24px">${R.icon('arrowRight', 15)}返回公告</a>
    <div class="news-detail__title">
      ${a.pinned ? `<span class="pin">置顶</span>` : ''}${R.esc(a.title)}
    </div>
    <div class="at-detail__meta" style="margin-top:14px">
      <span class="badge badge-brand">${R.esc(a.tag)}</span>
      <span>${R.fmtDate(a.published_at, true)}</span>
    </div>
    <p class="news-detail__summary">${R.esc(a.summary)}</p>
    <div class="prose news-detail__body">${R.nl2p(a.body)}</div>
  </div>
</main>
${R.siteFooter({ settings: s, navItems: nav, friends, subpage: s.subpage_name })}
`;

  res.send(
    R.layout({
      page: 'portal',
      bodyClass: 'page-portal',
      title: a.title,
      description: a.summary,
      styles: ['/assets/css/portal.css'],
      settings: s,
      user: req.user,
      body,
    })
  );
});

/* ---------------------------------------------------------------- 联系表单 */

router.post('/api/contact', express.json({ limit: '64kb' }), (req, res) => {
  const s = getSettings();
  if (!toBool(s.enable_contact_form)) {
    return res.status(403).json({ ok: false, error: '留言功能当前已关闭' });
  }
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 60);
  const body = String(b.body || '').trim().slice(0, 2000);
  if (!name || !body) {
    return res.status(400).json({ ok: false, error: '请填写称呼与内容' });
  }
  const { run } = require('../db');
  run(
    'INSERT INTO messages (name, contact, subject, body, ip) VALUES (?,?,?,?,?)',
    name,
    String(b.contact || '').trim().slice(0, 120),
    String(b.subject || '').trim().slice(0, 120),
    body,
    clientIp(req)
  );
  res.json({ ok: true, message: '已收到留言' });
});

module.exports = router;
