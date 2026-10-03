/* ==========================================================================
   Prax 前端交互（零依赖）
   - 进站加载动效
   - 滚动显现 / 页头收缩
   - 移动端导航
   - Toast 提示
   - 弹窗、详情面板
   - 表单提交（联系表单 / 登录）
   - 后台：标签页、行内操作、通用 AJAX 表单
   ========================================================================== */
(function () {
  'use strict';

  var W = window;
  var D = document;

  function $(sel, root) {
    return (root || D).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || D).querySelectorAll(sel));
  }

  function reduced() {
    return W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ------------------------------------------------------------ 主题令牌 */
  function applyTheme() {
    var t = (W.__PRAX__ && W.__PRAX__.theme) || null;
    if (!t) return;
    var r = D.documentElement.style;
    if (t.primary) r.setProperty('--prax-orange', t.primary);
    if (t.accent) r.setProperty('--prax-yellow', t.accent);
    if (t.cream) r.setProperty('--prax-cream', t.cream);
  }

  /* ------------------------------------------------------------ 预加载动效 */
  function preloader() {
    var el = $('#preloader');
    var bar = $('#preloaderBar');
    if (!el) return;
    D.body.classList.add('is-locked');

    var p = 0;
    var timer = setInterval(function () {
      p = Math.min(94, p + Math.random() * 16 + 6);
      if (bar) bar.style.width = p + '%';
    }, 130);

    function done() {
      clearInterval(timer);
      if (bar) bar.style.width = '100%';
      setTimeout(function () {
        el.classList.add('is-done');
        D.body.classList.remove('is-locked');
        revealInit();
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 700);
      }, 260);
    }

    if (D.readyState === 'complete') {
      setTimeout(done, 320);
    } else {
      W.addEventListener('load', function () {
        setTimeout(done, 340);
      });
      // 兜底：无论资源是否卡住，最多 3.2 秒后放行
      setTimeout(done, 3200);
    }
  }

  /* ------------------------------------------------------------ 滚动显现 */
  var revealObserver = null;

  function revealInit() {
    var items = $$('.reveal:not(.is-in)');
    if (!items.length) return;

    if (reduced() || !('IntersectionObserver' in W)) {
      items.forEach(function (el) {
        el.classList.add('is-in');
      });
      return;
    }

    if (!revealObserver) {
      revealObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              e.target.classList.add('is-in');
              revealObserver.unobserve(e.target);
            }
          });
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
      );
    }
    items.forEach(function (el) {
      revealObserver.observe(el);
    });
  }

  /* ------------------------------------------------------------ 页头状态 */
  function headerState() {
    var header = $('#siteHeader');
    if (!header) return;
    var onScroll = function () {
      header.classList.toggle('is-stuck', W.scrollY > 24);
    };
    onScroll();
    W.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ------------------------------------------------------------ 移动端导航 */
  function navToggle() {
    var btn = $('#navToggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var open = D.body.classList.toggle('nav-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      var use = btn.querySelector('svg');
      if (use) use.style.transform = '';
    });
    $$('.nav__link').forEach(function (a) {
      a.addEventListener('click', function () {
        D.body.classList.remove('nav-open');
        btn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ------------------------------------------------------------ Toast */
  function toast(msg, kind) {
    var host = $('#toastHost');
    if (!host) {
      host = D.createElement('div');
      host.className = 'toast-host';
      host.id = 'toastHost';
      D.body.appendChild(host);
    }
    var el = D.createElement('div');
    el.className = 'toast' + (kind ? ' toast-' + kind : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 280);
    }, 3200);
  }

  W.praxToast = toast;

  /* ------------------------------------------------------------ 弹窗 */
  function modalOpen(id) {
    var m = D.getElementById(id);
    if (!m) return;
    m.classList.add('is-open');
    D.body.classList.add('is-locked');
    var f = m.querySelector('[data-autofocus]');
    if (f) setTimeout(function () { f.focus(); }, 60);
  }

  function modalClose(m) {
    if (!m) return;
    m.classList.remove('is-open');
    D.body.classList.remove('is-locked');
  }

  W.praxModalOpen = modalOpen;
  W.praxModalClose = modalClose;

  function modalInit() {
    D.addEventListener('click', function (e) {
      var opener = e.target.closest('[data-modal-open]');
      if (opener) {
        e.preventDefault();
        modalOpen(opener.getAttribute('data-modal-open'));
        return;
      }
      var closer = e.target.closest('[data-modal-close]');
      if (closer) {
        e.preventDefault();
        modalClose(closer.closest('.modal'));
        return;
      }
      if (e.target.classList.contains('modal__veil')) {
        modalClose(e.target.closest('.modal'));
      }
    });
    D.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var open = $('.modal.is-open');
        if (open) modalClose(open);
      }
    });
  }

  /* ------------------------------------------------------------ AJAX 工具 */
  function api(url, opts) {
    var o = opts || {};
    var init = {
      method: o.method || 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    };
    if (o.body instanceof FormData) {
      init.body = o.body;
    } else if (o.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(o.body);
    }
    return fetch(url, init).then(function (res) {
      return res
        .json()
        .catch(function () {
          return { ok: false, error: '服务器返回了非预期的内容（HTTP ' + res.status + '）' };
        })
        .then(function (data) {
          if (!res.ok || data.ok === false) {
            throw new Error(data.error || '请求失败（HTTP ' + res.status + '）');
          }
          return data;
        });
    });
  }

  W.praxApi = api;

  /* ------------------------------------------------------------ 联系表单 */
  function contactForm() {
    var form = $('#contactForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('[type=submit]');
      var data = new FormData(form);
      var payload = {};
      data.forEach(function (v, k) {
        payload[k] = v;
      });
      if (btn) btn.classList.add('is-disabled');
      api('/api/contact', { method: 'POST', body: payload })
        .then(function () {
          form.reset();
          toast('已收到你的留言，我们会尽快回复。', 'ok');
        })
        .catch(function (err) {
          toast(err.message, 'err');
        })
        .finally(function () {
          if (btn) btn.classList.remove('is-disabled');
        });
    });
  }

  /* ------------------------------------------------------------ 登录表单 */
  function loginForm() {
    var form = $('#loginForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('[type=submit]');
      var errBox = $('#loginError');
      var data = new FormData(form);
      if (errBox) errBox.textContent = '';
      if (btn) {
        btn.classList.add('is-disabled');
        btn.dataset.text = btn.textContent;
        btn.textContent = '正在登录…';
      }
      api('/api/auth/login', {
        method: 'POST',
        body: { username: data.get('username'), password: data.get('password') },
      })
        .then(function (r) {
          toast('登录成功，正在进入…', 'ok');
          var next = new URLSearchParams(location.search).get('next');
          location.href = (r && r.redirect) || next || '/admin';
        })
        .catch(function (err) {
          if (errBox) errBox.textContent = err.message;
          toast(err.message, 'err');
          if (btn) {
            btn.classList.remove('is-disabled');
            btn.textContent = btn.dataset.text || '登录';
          }
        });
    });
  }

  /* ------------------------------------------------------------ 通用表单提交 */
  function ajaxForms() {
    D.addEventListener('submit', function (e) {
      var form = e.target.closest('form[data-ajax]');
      if (!form) return;
      e.preventDefault();

      var method = (form.getAttribute('data-method') || 'POST').toUpperCase();
      var url = form.getAttribute('action') || location.pathname;
      var fd = new FormData(form);
      var payload = {};
      fd.forEach(function (v, k) {
        if (k.slice(-2) === '[]') {
          var key = k.slice(0, -2);
          if (!payload[key]) payload[key] = [];
          payload[key].push(v);
        } else {
          payload[k] = v;
        }
      });

      var btn = form.querySelector('[type=submit]');
      if (btn) btn.classList.add('is-disabled');

      var req = method === 'DELETE' ? api(url, { method: 'DELETE' }) : api(url, { method: method, body: payload });

      req
        .then(function (r) {
          toast((r && r.message) || '已保存', 'ok');
          var modal = form.closest('.modal');
          if (modal) modalClose(modal);
          var reload = form.getAttribute('data-reload');
          if (reload !== 'none') {
            setTimeout(function () {
              location.reload();
            }, 520);
          }
        })
        .catch(function (err) {
          toast(err.message, 'err');
        })
        .finally(function () {
          if (btn) btn.classList.remove('is-disabled');
        });
    });
  }

  /* ------------------------------------------------------------ 行内操作按钮 */
  function actionButtons() {
    D.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      var id = btn.getAttribute('data-id');
      var url = btn.getAttribute('data-url');
      var confirmText = btn.getAttribute('data-confirm');

      if (action === 'delete') {
        if (confirmText && !W.confirm(confirmText)) return;
        btn.classList.add('is-disabled');
        api(url || '/api/' + btn.getAttribute('data-resource') + '/' + id, { method: 'DELETE' })
          .then(function (r) {
            toast((r && r.message) || '已删除', 'ok');
            var row = btn.closest('tr');
            if (row) {
              row.style.transition = 'opacity .3s';
              row.style.opacity = '0';
              setTimeout(function () {
                row.remove();
              }, 300);
            } else {
              setTimeout(function () {
                location.reload();
              }, 480);
            }
          })
          .catch(function (err) {
            toast(err.message, 'err');
            btn.classList.remove('is-disabled');
          });
        return;
      }

      if (action === 'toggle') {
        // data-field 指定要翻转的字段，data-resource 指定资源
        var field = btn.getAttribute('data-field') || 'visible';
        var value = btn.getAttribute('data-value');
        var body = {};
        body[field] = value === '1' ? 0 : 1;
        api((url || '/api/' + btn.getAttribute('data-resource')) + '/' + id, {
          method: 'PATCH',
          body: body,
        })
          .then(function () {
            toast('已更新', 'ok');
            location.reload();
          })
          .catch(function (err) {
            toast(err.message, 'err');
          });
        return;
      }

      if (action === 'pick') {
        // 从媒体库选择图片，回填到指定输入框
        var target = btn.getAttribute('data-target');
        var input = D.querySelector(target);
        if (input) {
          input.value = btn.getAttribute('data-url-value') || btn.getAttribute('data-url') || '';
          toast('已选择图片', 'ok');
          modalClose(btn.closest('.modal'));
        }
      }
    });
  }

  /* ------------------------------------------------------------ 标签页 */
  function tabs() {
    D.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-tab]');
      if (!tab) return;
      var group = tab.closest('[data-tab-group]');
      if (!group) return;
      var name = tab.getAttribute('data-tab');
      $$('[data-tab]', group).forEach(function (t) {
        t.classList.toggle('is-active', t === tab);
      });
      $$('[data-tab-panel]').forEach(function (p) {
        if (p.getAttribute('data-tab-scope') && p.getAttribute('data-tab-scope') !== group.getAttribute('data-tab-group')) return;
        p.hidden = p.getAttribute('data-tab-panel') !== name;
      });
    });
  }

  /* ------------------------------------------------------------ 子页面筛选 */
  function atelierFilter() {
    var bar = $('#atFilter');
    if (!bar) return;
    bar.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      var cat = chip.getAttribute('data-cat');
      $$('.chip', bar).forEach(function (c) {
        c.classList.toggle('is-active', c === chip);
      });
      var shown = 0;
      $$('[data-work-cat]').forEach(function (el) {
        var cats = el.getAttribute('data-work-cat').split(' ');
        var hit = cat === 'all' || cats.indexOf(cat) >= 0;
        el.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      var empty = $('#atEmpty');
      if (empty) empty.hidden = shown > 0;
    });

    // 详情：把数据从 data-* 读进弹窗，避免每个作品都渲染一个弹窗
    D.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-work-open]');
      if (!btn) return;
      var raw = btn.getAttribute('data-work-json');
      var data;
      try {
        data = JSON.parse(raw);
      } catch (_) {
        return;
      }
      var m = $('#workModal');
      if (!m) return;
      var cover = $('#workModalCover');
      if (cover) {
        if (data.cover) {
          cover.src = data.cover;
          cover.parentNode.hidden = false;
        } else {
          cover.parentNode.hidden = true;
        }
      }
      $('#workModalTitle').textContent = data.title || '';
      $('#workModalSub').textContent = [data.subtitle, data.year, data.credit].filter(Boolean).join(' · ');
      $('#workModalBody').innerHTML = data.bodyHtml || '';
      var tags = $('#workModalTags');
      tags.innerHTML = (data.tags || [])
        .map(function (t) {
          return '<span class="tag">' + String(t).replace(/[<>&"]/g, '') + '</span>';
        })
        .join('');
      var link = $('#workModalLink');
      if (data.linkUrl) {
        link.href = data.linkUrl;
        link.hidden = false;
      } else {
        link.hidden = true;
      }
      modalOpen('workModal');
    });
  }

  /* ------------------------------------------------------------ 后台：批量选择与筛选 */
  function adminTable() {
    // 全选
    var all = $('#checkAll');
    if (all) {
      all.addEventListener('change', function () {
        $$('input[name="ids[]"]').forEach(function (c) {
          c.checked = all.checked;
        });
        updateBulk();
      });
      D.addEventListener('change', function (e) {
        if (e.target.name === 'ids[]') updateBulk();
      });
      function updateBulk() {
        var bar = $('#bulkBar');
        if (!bar) return;
        var n = $$('input[name="ids[]"]:checked').length;
        bar.hidden = n === 0;
        var c = $('#bulkCount');
        if (c) c.textContent = n;
      }
    }

    // 前端即时筛选
    var search = $('#tableSearch');
    if (search) {
      search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        var rows = $$('table.data tbody tr');
        var shown = 0;
        rows.forEach(function (tr) {
          var hit = !q || tr.textContent.toLowerCase().indexOf(q) >= 0;
          tr.style.display = hit ? '' : 'none';
          if (hit) shown++;
        });
        var none = $('#tableNone');
        if (none) none.hidden = shown > 0;
      });
    }
  }

  /* ------------------------------------------------------------ 后台：侧栏 */
  function adminNav() {
    var btn = $('#adminNavToggle');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      $('#adminShell').classList.toggle('nav-open');
    });
    D.addEventListener('click', function (e) {
      var shell = $('#adminShell');
      if (!shell || !shell.classList.contains('nav-open')) return;
      if (!e.target.closest('.admin-side') && !e.target.closest('#adminNavToggle')) {
        shell.classList.remove('nav-open');
      }
    });
  }

  /* ------------------------------------------------------------ 后台：退出 */
  function logoutBtn() {
    var b = $('#logoutBtn');
    if (!b) return;
    b.addEventListener('click', function (e) {
      e.preventDefault();
      api('/api/auth/logout', { method: 'POST' })
        .then(function () {
          location.href = '/admin/login';
        })
        .catch(function () {
          location.href = '/admin/login';
        });
    });
  }

  /* ------------------------------------------------------------ 自动刷新状态 */
  function autoDismissFlash() {
    var f = $('[data-flash]');
    if (!f) return;
    setTimeout(function () {
      f.style.transition = 'opacity .4s, transform .4s';
      f.style.opacity = '0';
      f.style.transform = 'translateY(-6px)';
      setTimeout(function () {
        f.remove();
      }, 420);
    }, 4200);
  }

  /* ------------------------------------------------------------ 启动 */
  function boot() {
    applyTheme();
    preloader();
    headerState();
    navToggle();
    modalInit();
    contactForm();
    loginForm();
    ajaxForms();
    actionButtons();
    tabs();
    atelierFilter();
    adminTable();
    adminNav();
    logoutBtn();
    autoDismissFlash();
    revealInit();
  }

  if (D.readyState === 'loading') {
    D.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
