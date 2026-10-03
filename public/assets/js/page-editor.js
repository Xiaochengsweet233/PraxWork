/* ==========================================================================
   页面编辑器（后台）
   - 实时预览：把正文 POST 到 /api/pages/preview，用与前台一致的渲染管线
   - 工具栏插入、Tab 缩进、快捷键
   - 分栏 / 仅编辑 / 仅预览 三种视图
   - 历史版本查看与回滚
   依赖 app.js 暴露的 praxApi / praxToast / praxModalOpen
   ========================================================================== */
(function () {
  'use strict';

  var D = document;
  var W = window;

  function $(s, r) {
    return (r || D).querySelector(s);
  }

  var input = $('#edInput');
  var hidden = $('#pageBody');
  var preview = $('#edPreview');
  var form = $('#pageForm');
  if (!input || !form) return;

  /* -------------------------------------------------- 初值 */
  input.value = hidden.value || '';

  var state = {
    format: ($('#p_format') && $('#p_format').value) || 'markdown',
    view: 'split',
    timer: null,
    inflight: false,
    pending: false,
    dirty: false,
  };

  /* -------------------------------------------------- 工具栏提示文案 */
  var HINTS = {
    markdown:
      'Markdown：正文里的 HTML 标签会被原样显示成文字（不会执行），这是安全设计。需要真正的 HTML 排版请切到 HTML 格式。',
    html:
      'HTML：可自由排版、写内联样式。出于安全，script / iframe / on* 事件等会被自动清除，保存时即生效。',
  };

  function applyFormatHint() {
    var el = $('#fmthint');
    if (el) el.textContent = HINTS[state.format] || '';
    // 切换格式时重绘工具栏（Markdown 与 HTML 的可插入语法不同）
    var bar = $('#edToolbar');
    if (!bar) return;
    var tools = bar.querySelectorAll('.ed-tool[data-tool]');
    Array.prototype.forEach.call(tools, function (b) {
      var md = b.getAttribute('data-md');
      var html = b.getAttribute('data-html');
      var keep = state.format === 'html' ? html && html !== 'null' : md && md !== 'null';
      // 「表格/分隔线/列表」两种格式都有；这里只隐藏某格式不支持的那个
      b.hidden = !keep;
    });
  }

  /* -------------------------------------------------- 字数统计 */
  function updateStatus() {
    var text = input.value;
    var chars = text.length;
    var lines = text ? text.split('\n').length : 0;
    var c = $('#edCount');
    var l = $('#edLines');
    if (c) c.textContent = chars.toLocaleString() + ' 字';
    if (l) l.textContent = lines.toLocaleString() + ' 行';
  }

  function setSaved(txt, tone) {
    var el = $('#edSaved');
    if (!el) return;
    el.textContent = txt;
    el.style.color = tone === 'warn' ? '#8a6200' : tone === 'err' ? '#b3372c' : '';
  }

  /* -------------------------------------------------- 预览 */
  function renderPreview() {
    if (!preview) return;
    if (state.inflight) {
      state.pending = true;
      return;
    }
    state.inflight = true;
    setSaved('预览中…');

    W.praxApi('/api/pages/preview', {
      method: 'POST',
      body: { body: input.value, format: state.format },
    })
      .then(function (r) {
        preview.innerHTML =
          r.html && r.html.trim()
            ? r.html
            : '<div class="ed-preview__empty"><p>（空内容）</p></div>';
        setSaved('预览已更新');
      })
      .catch(function (e) {
        preview.innerHTML =
          '<div class="ed-preview__empty"><p>预览失败：' +
          String(e.message).replace(/[<>&]/g, '') +
          '</p></div>';
        setSaved('预览失败', 'err');
      })
      .finally(function () {
        state.inflight = false;
        if (state.pending) {
          state.pending = false;
          renderPreview();
        }
      });
  }

  function schedulePreview() {
    clearTimeout(state.timer);
    state.timer = setTimeout(renderPreview, 260);
  }

  function markDirty() {
    state.dirty = true;
    setSaved('未保存', 'warn');
    var h = $('#pageBody');
    if (h) h.value = input.value;
  }

  /* -------------------------------------------------- 输入事件 */
  input.addEventListener('input', function () {
    markDirty();
    updateStatus();
    schedulePreview();
  });

  /* -------------------------------------------------- Tab 缩进 / 快捷键 */
  input.addEventListener('keydown', function (e) {
    // Tab：插入两个空格（Shift+Tab 反缩进）
    if (e.key === 'Tab') {
      e.preventDefault();
      var s = input.selectionStart;
      var en = input.selectionEnd;

      if (e.shiftKey) {
        var lineStart = input.value.lastIndexOf('\n', s - 1) + 1;
        var head = input.value.slice(lineStart, lineStart + 2);
        if (head === '  ') {
          input.value = input.value.slice(0, lineStart) + input.value.slice(lineStart + 2);
          input.selectionStart = input.selectionEnd = Math.max(lineStart, s - 2);
        }
      } else {
        // 多行选中时整体缩进
        if (s !== en && input.value.slice(s, en).indexOf('\n') >= 0) {
          var start = input.value.lastIndexOf('\n', s - 1) + 1;
          var chunk = input.value.slice(start, en);
          var shifted = chunk.replace(/^/gm, '  ');
          input.value = input.value.slice(0, start) + shifted + input.value.slice(en);
          input.selectionStart = start;
          input.selectionEnd = start + shifted.length;
        } else {
          insertText('  ', '');
        }
      }
      markDirty();
      updateStatus();
      schedulePreview();
      return;
    }

    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    var k = e.key.toLowerCase();
    if (k === 'b') {
      e.preventDefault();
      wrapSelection('**', '**');
    } else if (k === 'i') {
      e.preventDefault();
      wrapSelection('*', '*');
    } else if (k === 'k') {
      e.preventDefault();
      wrapSelection('[', '](https://)');
    } else if (k === 's') {
      e.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.submit();
    }
  });

  /* -------------------------------------------------- 插入辅助 */
  function insertText(before, after) {
    var s = input.selectionStart;
    var en = input.selectionEnd;
    var val = input.value;
    var sel = val.slice(s, en);
    input.value = val.slice(0, s) + before + sel + after + val.slice(en);
    var caret = s + before.length + sel.length;
    input.selectionStart = input.selectionEnd = after ? caret : s + before.length;
    input.focus();
  }

  function wrapSelection(before, after) {
    insertText(before, after);
    markDirty();
    updateStatus();
    schedulePreview();
  }

  /** 行首插入（标题、列表、引用） */
  function prefixLines(prefix, isOrdered) {
    var val = input.value;
    var s = input.selectionStart;
    var en = input.selectionEnd;
    var start = val.lastIndexOf('\n', s - 1) + 1;
    var stop = val.indexOf('\n', en);
    if (stop < 0) stop = val.length;

    var chunk = val.slice(start, stop);
    var lines = chunk.split('\n');
    var out = lines
      .map(function (line, i) {
        var stripped = line.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+/, '');
        if (isOrdered) return prefix + (i + 1) + '. ' + stripped;
        return prefix + stripped;
      })
      .join('\n');

    input.value = val.slice(0, start) + out + val.slice(stop);
    input.selectionStart = start;
    input.selectionEnd = start + out.length;
    input.focus();
    markDirty();
    updateStatus();
    schedulePreview();
  }

  /* -------------------------------------------------- 工具栏点击 */
  D.addEventListener('click', function (e) {
    var btn = e.target.closest('.ed-tool[data-tool]');
    if (!btn) return;
    e.preventDefault();
    var key = btn.getAttribute('data-tool');
    var raw =
      state.format === 'html' ? btn.getAttribute('data-html') : btn.getAttribute('data-md');
    var spec;
    try {
      spec = JSON.parse(raw);
    } catch (_) {
      return;
    }
    if (spec === null || spec === undefined) return;

    var isLine = btn.getAttribute('data-wrap') === 'line';

    if (key === 'ul') return prefixLines('- ');
    if (key === 'ol') return prefixLines('', true);
    if (key === 'quote') return prefixLines('> ');
    if (isLine && typeof spec === 'string') {
      // 标题类：插入到当前行行首
      return prefixLines(spec);
    }
    if (typeof spec === 'string') {
      insertText(spec, '');
      markDirty();
      updateStatus();
      schedulePreview();
      return;
    }
    if (Array.isArray(spec)) return wrapSelection(spec[0], spec[1]);
  });

  /* -------------------------------------------------- 格式切换 */
  var seg = $('#fmtSeg');
  if (seg) {
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('.seg__btn');
      if (!b) return;
      state.format = b.getAttribute('data-fmt');
      var h = $('#p_format');
      if (h) h.value = state.format;
      Array.prototype.forEach.call(seg.querySelectorAll('.seg__btn'), function (x) {
        x.classList.toggle('is-on', x === b);
      });
      applyFormatHint();
      markDirty();
      renderPreview();
    });
  }

  /* -------------------------------------------------- 视图切换 */
  var viewBox = D.querySelector('.ed-view');
  if (viewBox) {
    viewBox.addEventListener('click', function (e) {
      var b = e.target.closest('.ed-view__btn');
      if (!b) return;
      state.view = b.getAttribute('data-view');
      Array.prototype.forEach.call(viewBox.querySelectorAll('.ed-view__btn'), function (x) {
        x.classList.toggle('is-on', x === b);
      });
      var split = $('#edSplit');
      if (split) split.setAttribute('data-view', state.view);
    });
  }

  /* -------------------------------------------------- 插图（写入光标处） */
  var insertImg = $('#insertImg');
  if (insertImg) {
    insertImg.addEventListener('click', function () {
      W.praxModalOpen('mediaModal');
      // 媒体库的「选择」按钮会回填到 data-target；这里临时把目标指向编辑器
      var modal = $('#mediaModal');
      if (!modal) return;
      modal.setAttribute('data-editor-image', '1');
    });
  }

  // 监听媒体选择：如果是从编辑器打开的，就插入 Markdown/HTML 图片语法
  D.addEventListener('click', function (e) {
    var pick = e.target.closest('[data-action="pick"]');
    if (!pick) return;
    var modal = D.getElementById('mediaModal');
    if (!modal || modal.getAttribute('data-editor-image') !== '1') return;
    var url = pick.getAttribute('data-url-value') || '';
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    if (state.format === 'html') {
      insertText('<img src="' + url + '" alt="">', '');
    } else {
      insertText('![](' + url + ')', '');
    }
    modal.removeAttribute('data-editor-image');
    W.praxModalClose(modal);
    markDirty();
    updateStatus();
    schedulePreview();
  }, true);

  /* -------------------------------------------------- 语法速查 */
  var HELP = {
    markdown: [
      ['# 一级标题', '标题用 1~6 个 #'],
      ['**加粗**   *斜体*   ~~删除~~', '文字样式'],
      ['`行内代码`', '代码片段'],
      ['- 列表项', '无序列表；1. 开头是有序列表'],
      ['> 引用', '引用块'],
      ['[文字](https://a.com)', '链接'],
      ['![说明](/uploads/a.png)', '图片'],
      ['| 表头 | 表头 |<br>| --- | --- |<br>| 内容 | 内容 |', '表格'],
      ['---', '分隔线'],
      ['```<br>代码块<br>```', '多行代码'],
    ],
    html: [
      ['<h2>标题</h2>', '标题'],
      ['<p style="color:#c34c18">橙色文字</p>', '内联样式'],
      ['<div class="card">…</div>', '分块'],
      ['<ul><li>项目</li></ul>', '列表'],
      ['<img src="/uploads/a.png" alt="说明">', '图片'],
      ['<a href="/atelier">工坊</a>', '链接'],
      ['<table><tr><td>1</td></tr></table>', '表格'],
      ['<details><summary>展开</summary>内容</details>', '折叠块'],
      ['<style>.card{border:1px solid #eee}</style>', '页面级样式'],
    ],
  };

  var mdHelp = $('#mdHelp');
  if (mdHelp) {
    mdHelp.addEventListener('click', function () {
      var box = $('#helpBody');
      if (!box) return;
      var rows = HELP[state.format] || HELP.markdown;
      box.innerHTML =
        '<p class="muted" style="margin-top:0">当前格式：' +
        (state.format === 'html' ? 'HTML' : 'Markdown') +
        '</p><table class="data"><thead><tr><th>写法</th><th>说明</th></tr></thead><tbody>' +
        rows
          .map(function (r) {
            return '<tr><td><code>' + r[0].replace(/</g, '&lt;') + '</code></td><td>' + r[1] + '</td></tr>';
          })
          .join('') +
        '</tbody></table>' +
        (state.format === 'html'
          ? '<p class="muted" style="margin-bottom:0">为安全起见，script、iframe、on* 事件属性会在保存时被自动清除。</p>'
          : '<p class="muted" style="margin-bottom:0">Markdown 正文中的 HTML 标签会显示为文字，不会被解析执行。</p>');
      W.praxModalOpen('helpModal');
    });
  }

  /* -------------------------------------------------- 历史版本 */
  var revBtn = $('#revBtn');
  if (revBtn) {
    revBtn.addEventListener('click', function () {
      var pageId = form.getAttribute('action').split('/').pop();
      var box = $('#revBody');
      box.innerHTML = '<div class="empty"><p>加载中…</p></div>';
      W.praxModalOpen('revModal');

      W.praxApi('/api/pages/' + pageId + '/revisions')
        .then(function (r) {
          if (!r.items.length) {
            box.innerHTML =
              '<div class="empty">' + '<p>还没有历史版本。保存一次之后就会开始留档。</p></div>';
            return;
          }
          box.innerHTML =
            '<div class="rev-list">' +
            r.items
              .map(function (it) {
                return (
                  '<div class="rev-item">' +
                  '<div class="rev-item__main">' +
                  '<b>#' +
                  it.id +
                  '</b> ' +
                  '<span class="muted">' +
                  String(it.note || '').replace(/[<>&]/g, '') +
                  '</span>' +
                  '<div class="rev-item__meta">' +
                  String(it.username || '—') +
                  ' · ' +
                  String(it.created_at || '') +
                  ' · ' +
                  Math.round((it.size || 0) / 1024 * 10) / 10 +
                  ' KB · ' +
                  (it.format === 'html' ? 'HTML' : 'Markdown') +
                  '</div>' +
                  '</div>' +
                  '<div class="rev-item__act">' +
                  '<button class="btn btn-ghost btn-sm" type="button" data-rev-view="' +
                  it.id +
                  '">查看</button>' +
                  '<button class="btn btn-ghost btn-sm" type="button" data-rev-restore="' +
                  it.id +
                  '">回滚</button>' +
                  '</div>' +
                  '</div>'
                );
              })
              .join('') +
            '</div>';
        })
        .catch(function (e) {
          box.innerHTML = '<div class="empty"><p>' + String(e.message).replace(/[<>&]/g, '') + '</p></div>';
        });
    });
  }

  // 查看 / 回滚
  D.addEventListener('click', function (e) {
    var v = e.target.closest('[data-rev-view]');
    var rs = e.target.closest('[data-rev-restore]');
    if (!v && !rs) return;
    var pageId = form.getAttribute('action').split('/').pop();

    if (v) {
      var revId = v.getAttribute('data-rev-view');
      W.praxApi('/api/pages/' + pageId + '/revisions/' + revId).then(function (r) {
        var rev = r.revision;
        var box = $('#revBody');
        box.innerHTML =
          '<div class="rev-view">' +
          '<div class="row-inline" style="margin-bottom:12px">' +
          '<button class="btn btn-primary btn-sm" type="button" data-rev-restore="' + revId + '">回滚到此版本</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-rev-back>返回列表</button>' +
          '</div>' +
          '<pre class="rev-code"></pre>' +
          '</div>';
        // 用 textContent 写入，确保版本内容按纯文本展示、不会被执行
        box.querySelector('.rev-code').textContent = rev.body || '(空)';
      });
      return;
    }

    if (rs) {
      var rid = rs.getAttribute('data-rev-restore');
      if (!W.confirm('确定回滚到这个版本吗？当前内容会先自动留档，之后仍可再切回来。')) return;
      W.praxApi('/api/pages/' + pageId + '/revisions/' + rid + '/restore', { method: 'POST' })
        .then(function () {
          W.praxToast('已回滚，页面即将刷新', 'ok');
          setTimeout(function () {
            location.reload();
          }, 700);
        })
        .catch(function (err) {
          W.praxToast(err.message, 'err');
        });
    }
  });

  D.addEventListener('click', function (e) {
    if (e.target.closest('[data-rev-back]')) {
      var btn = $('#revBtn');
      if (btn) btn.click();
    }
  });

  /* -------------------------------------------------- 提交 */
  /**
   * 自己构造 payload，不用 FormData 直接展开：
   * 布尔开关用「隐藏域 0 + 复选框 1」的写法，展开后会同时出现两个同名值，
   * 这里按「复选框优先」的语义显式取值，避免依赖遍历顺序。
   */
  function collectPayload() {
    var payload = {};
    var formData = new FormData(form);

    formData.forEach(function (value, key) {
      if (key === 'body') return; // 正文单独从编辑器取
      payload[key] = value;
    });

    // 显式处理布尔字段
    ['visible', 'in_nav', 'show_header', 'show_footer'].forEach(function (name) {
      var cb = form.querySelector('input[type="checkbox"][name="' + name + '"]');
      payload[name] = cb && cb.checked ? '1' : '0';
    });

    payload.body = input.value;
    payload.format = state.format;
    return payload;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hidden.value = input.value;
    clearTimeout(state.timer);

    var isEdit = (form.getAttribute('data-method') || '').toUpperCase() === 'PATCH';
    var btn = form.querySelector('[type=submit]');
    if (btn) btn.classList.add('is-disabled');
    setSaved('保存中…');

    W.praxApi(form.getAttribute('action'), {
      method: isEdit ? 'PATCH' : 'POST',
      body: collectPayload(),
    })
      .then(function (res) {
        state.dirty = false;
        W.praxToast(res.message || '已保存', 'ok');
        var url = res.url || (res.slug ? '/p/' + res.slug : '');
        // 新建后进入编辑页，之后每次保存都停留在原页
        if (!isEdit && res.id) {
          location.href = '/admin/pages/' + res.id;
        } else if (url) {
          setSaved('已保存');
          // 刷新一下以便显示最新的页头/导航等状态
          setTimeout(function () {
            location.reload();
          }, 500);
        }
      })
      .catch(function (err) {
        setSaved('保存失败', 'err');
        W.praxToast(err.message, 'err');
        if (btn) btn.classList.remove('is-disabled');
      });
  });

  /* -------------------------------------------------- 离开未保存提醒 */
  W.addEventListener('beforeunload', function (e) {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  /* -------------------------------------------------- 启动 */
  applyFormatHint();
  updateStatus();
  renderPreview();
})();
