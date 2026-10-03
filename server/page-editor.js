'use strict';
/**
 * 页面编辑器界面
 *
 * 设计取舍：
 *   - 不引入 CodeMirror 等编辑器库（保持零构建）。用原生 <textarea> +
 *     自写的工具栏（插入语法、Tab 缩进、快捷键、实时字数），
 *     在"够用"和"零依赖"之间取平衡。
 *   - 左侧写、右侧实时预览。预览是把正文 POST 到 /api/pages/preview，
 *     用**与前台完全相同**的渲染管线（Markdown 渲染器 / HTML 清洗器），
 *     所以"预览所见 = 前台所得"，不会出现预览通过、前台被过滤的落差。
 *   - HTML 模式会明确提示会被清洗掉哪些东西，避免"我写的脚本没了"的困惑。
 */

const R = require('./render');

/** 编辑器工具栏按钮定义 */
const TOOLBAR = [
  { key: 'h1', label: 'H1', title: '一级标题', md: '# ', wrap: 'line' },
  { key: 'h2', label: 'H2', title: '二级标题', md: '## ', wrap: 'line' },
  { key: 'h3', label: 'H3', title: '三级标题', md: '### ', wrap: 'line' },
  { key: 'bold', label: 'B', title: '加粗（Ctrl+B）', md: ['**', '**'], html: ['<strong>', '</strong>'] },
  { key: 'italic', label: 'I', title: '斜体（Ctrl+I）', md: ['*', '*'], html: ['<em>', '</em>'] },
  { key: 'strike', label: 'S', title: '删除线', md: ['~~', '~~'], html: ['<del>', '</del>'] },
  { key: 'code', label: '</>', title: '行内代码', md: ['`', '`'], html: ['<code>', '</code>'] },
  { key: 'link', label: '🔗', title: '链接（Ctrl+K）', md: ['[', '](https://)'], html: ['<a href="https://">', '</a>'] },
  { key: 'image', label: '🖼', title: '图片', md: ['![', '](/assets/img/)'], html: ['<img src="/assets/img/" alt="">', ''] },
  { key: 'ul', label: '•', title: '无序列表', md: '- ', wrap: 'line' },
  { key: 'ol', label: '1.', title: '有序列表', md: '1. ', wrap: 'line' },
  { key: 'quote', label: '❝', title: '引用', md: '> ', wrap: 'line' },
  { key: 'hr', label: '—', title: '分隔线', md: '\n---\n' },
  { key: 'table', label: '⊞', title: '表格', md: '\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n' },
];

function toolbarHtml(format) {
  return TOOLBAR.map((btn) => {
    const has = format === 'html' ? btn.html || btn.md : btn.md;
    if (!has) return '';
    return (
      `<button class="ed-tool" type="button" ` +
      `data-tool="${R.escAttr(btn.key)}" title="${R.escAttr(btn.title)}" ` +
      `data-md='${R.escAttr(JSON.stringify(btn.md || null))}' ` +
      `data-html='${R.escAttr(JSON.stringify(btn.html || null))}' ` +
      `data-wrap="${R.escAttr(btn.wrap || '')}">${R.esc(btn.label)}</button>`
    );
  }).join('');
}

/**
 * 页面编辑表单
 * @param {object|null} row 已有页面（编辑）或 null（新建）
 */
function pageEditor(row) {
  const isEdit = !!row;
  const r = row || {
    title: '',
    slug: '',
    format: 'markdown',
    layout: 'cream',
    summary: '',
    body: '',
    cover: '',
    in_nav: 0,
    nav_label: '',
    visible: 1,
    show_header: 1,
    show_footer: 1,
    sort_order: 0,
  };

  const fmt = r.format === 'html' ? 'html' : 'markdown';

  return `
<form action="${isEdit ? `/api/pages/${r.id}` : '/api/pages'}"${
    isEdit ? ' data-method="PATCH"' : ''
  } id="pageForm">
  <input type="hidden" name="body" id="pageBody" value="${R.escAttr(r.body || '')}">

  <div class="ed-layout">
    <!-- 左：设置 -->
    <div class="ed-side">
      <div class="panel">
        <div class="panel__head"><h3>页面设置</h3></div>
        <div class="panel__body">
          <div class="field">
            <label for="p_title">页面标题</label>
            <input class="input" id="p_title" name="title" required value="${R.escAttr(r.title)}" placeholder="例如：关于我们">
          </div>

          <div class="field">
            <label for="p_slug">访问路径</label>
            <div class="input-group">
              <span class="input-group__prefix">/p/</span>
              <input class="input" id="p_slug" name="slug" value="${R.escAttr(r.slug)}" placeholder="about">
            </div>
            <div class="hint">留空则按标题自动生成；只能用小写字母、数字与连字符</div>
          </div>

          <div class="field">
            <label>内容格式</label>
            <div class="seg" id="fmtSeg">
              <button class="seg__btn${fmt === 'markdown' ? ' is-on' : ''}" type="button" data-fmt="markdown">
                Markdown
              </button>
              <button class="seg__btn${fmt === 'html' ? ' is-on' : ''}" type="button" data-fmt="html">
                HTML
              </button>
            </div>
            <input type="hidden" name="format" id="p_format" value="${R.escAttr(fmt)}">
            <div class="hint" id="fmthint"></div>
          </div>

          <div class="field">
            <label for="p_layout">页面皮肤</label>
            <select class="select" id="p_layout" name="layout">
              <option value="cream"${r.layout === 'cream' ? ' selected' : ''}>米白（默认）</option>
              <option value="plain"${r.layout === 'plain' ? ' selected' : ''}>纯净（无页头页脚）</option>
              <option value="portal"${r.layout === 'portal' ? ' selected' : ''}>深橙（同门户）</option>
            </select>
          </div>

          <div class="field">
            <label for="p_summary">摘要</label>
            <textarea class="textarea" id="p_summary" name="summary" style="min-height:74px" placeholder="一两句话说明这个页面">${R.esc(
              r.summary
            )}</textarea>
          </div>

          <div class="field">
            <label for="p_cover">题图</label>
            <div class="media-field">
              <div class="media-field__preview" data-preview-for="cover">
                ${
                  r.cover
                    ? `<img src="${R.escAttr(r.cover)}" alt="">`
                    : `<span class="media-field__empty">${R.icon('image', 20)}</span>`
                }
              </div>
              <div class="media-field__side">
                <input class="input" id="p_cover" name="cover" value="${R.escAttr(r.cover)}" placeholder="/assets/...">
                <div class="row-inline">
                  <button class="btn btn-ghost btn-sm" type="button" data-modal-open="mediaModal">媒体库</button>
                  <button class="btn btn-ghost btn-sm" type="button" data-clear-for="cover">清空</button>
                </div>
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="field">
            <label class="check"><input type="hidden" name="visible" value="0"><input type="checkbox" name="visible" value="1"${
              r.visible ? ' checked' : ''
            }><span>对外可见</span></label>
            <label class="check"><input type="hidden" name="in_nav" value="0"><input type="checkbox" name="in_nav" value="1"${
              r.in_nav ? ' checked' : ''
            }><span>加入页头导航<small>勾选后前台页头会自动出现这个页面</small></span></label>
            <label class="check"><input type="hidden" name="show_header" value="0"><input type="checkbox" name="show_header" value="1"${
              r.show_header ? ' checked' : ''
            }><span>显示页头</span></label>
            <label class="check"><input type="hidden" name="show_footer" value="0"><input type="checkbox" name="show_footer" value="1"${
              r.show_footer ? ' checked' : ''
            }><span>显示页脚</span></label>
          </div>

          <div class="grid-2">
            <div class="field">
              <label for="p_nav_label">导航文字</label>
              <input class="input" id="p_nav_label" name="nav_label" value="${R.escAttr(
                r.nav_label
              )}" placeholder="留空用标题">
            </div>
            <div class="field">
              <label for="p_sort">排序</label>
              <input class="input" type="number" id="p_sort" name="sort_order" value="${R.escAttr(
                r.sort_order
              )}">
            </div>
          </div>
        </div>
        <div class="panel__foot">
          <button class="btn btn-primary" type="submit">${R.icon('check', 16)}${
    isEdit ? '保存页面' : '创建页面'
  }</button>
          <a class="btn btn-ghost" href="/admin/pages">返回列表</a>
          ${
            isEdit
              ? `<span class="toolbar__spacer"></span>
                 <button class="btn btn-ghost btn-sm" type="button" id="revBtn">${R.icon(
                   'clock',
                   14
                 )}历史版本</button>
                 <a class="btn btn-ghost btn-sm" href="/p/${R.escAttr(r.slug)}" target="_blank" rel="noopener">${R.icon(
                   'external',
                   14
                 )}查看</a>`
              : ''
          }
        </div>
      </div>
    </div>

    <!-- 右：编辑器 + 预览 -->
    <div class="ed-main">
      <div class="panel ed-panel">
        <div class="panel__head">
          <h3>正文</h3>
          <span class="toolbar__spacer"></span>
          <div class="ed-view">
            <button class="ed-view__btn is-on" type="button" data-view="split">分栏</button>
            <button class="ed-view__btn" type="button" data-view="write">仅编辑</button>
            <button class="ed-view__btn" type="button" data-view="preview">仅预览</button>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" id="insertImg">${R.icon('image', 14)}插图</button>
        </div>

        <div class="ed-toolbar" id="edToolbar">
          ${toolbarHtml(fmt)}
          <span class="ed-toolbar__sep"></span>
          <button class="ed-tool" type="button" id="mdHelp" title="语法速查">?</button>
        </div>

        <div class="ed-split" id="edSplit">
          <div class="ed-pane ed-pane--write">
            <textarea class="ed-textarea" id="edInput" spellcheck="false" placeholder="在这里写内容…

Markdown 常用写法：
# 一级标题
**加粗** · *斜体* · ` + '`代码`' + `
- 列表项
[链接](https://example.com)
![图片](/uploads/xxx.png)

> 引用
| 表头 | 表头 |
| --- | --- |
| 内容 | 内容 |"></textarea>
            <div class="ed-status">
              <span id="edCount">0 字</span>
              <span class="ed-status__dot"></span>
              <span id="edLines">0 行</span>
              <span class="toolbar__spacer"></span>
              <span id="edSaved">未保存</span>
            </div>
          </div>
          <div class="ed-pane ed-pane--preview">
            <div class="ed-preview prose" id="edPreview">
              <div class="ed-preview__empty">${R.icon('eye', 26)}<p>预览会显示在这里</p></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</form>

<!-- 历史版本弹窗 -->
<div class="modal" id="revModal" role="dialog" aria-modal="true" aria-label="历史版本">
  <div class="modal__veil" data-modal-close></div>
  <div class="modal__panel modal-lg">
    <div class="modal__head">
      <h3>历史版本</h3>
      <button class="modal__x" type="button" data-modal-close aria-label="关闭">${R.icon('close', 18)}</button>
    </div>
    <div class="modal__body" id="revBody">
      <div class="empty">${R.icon('clock', 28)}<p>加载中…</p></div>
    </div>
    <div class="modal__foot">
      <button class="btn btn-ghost" type="button" data-modal-close>关闭</button>
    </div>
  </div>
</div>

<!-- 语法速查弹窗 -->
<div class="modal" id="helpModal" role="dialog" aria-modal="true" aria-label="语法速查">
  <div class="modal__veil" data-modal-close></div>
  <div class="modal__panel modal-lg">
    <div class="modal__head">
      <h3>语法速查</h3>
      <button class="modal__x" type="button" data-modal-close aria-label="关闭">${R.icon('close', 18)}</button>
    </div>
    <div class="modal__body" id="helpBody"></div>
    <div class="modal__foot">
      <button class="btn btn-ghost" type="button" data-modal-close>知道了</button>
    </div>
  </div>
</div>
`;
}

/** 页面列表（自定义，带格式徽标与快速操作） */
function pageList(list) {
  const rows = list
    .map((p) => {
      const fmt = p.format === 'html' ? 'html' : 'markdown';
      return `<tr>
  <td>
    <div class="t-title">${R.esc(p.title)}</div>
    <div class="t-sub mono">/p/${R.esc(p.slug)}</div>
  </td>
  <td><span class="fmt-badge fmt-${fmt}">${fmt === 'html' ? 'HTML' : 'MD'}</span></td>
  <td>${R.esc(p.layout === 'portal' ? '深橙' : p.layout === 'plain' ? '纯净' : '米白')}</td>
  <td>${p.visible ? R.badge('ok', '可见') : R.badge('muted', '隐藏')}</td>
  <td>${p.in_nav ? R.badge('brand', '导航中') : '<span class="muted">—</span>'}</td>
  <td><span class="muted" style="font-size:12.5px">${R.timeAgo(p.updated_at)}</span></td>
  <td class="col-act">
    <a class="btn btn-ghost btn-sm" href="/admin/pages/${p.id}">${R.icon('pencil', 14)}编辑</a>
    <a class="btn btn-ghost btn-sm" href="/p/${R.escAttr(p.slug)}" target="_blank" rel="noopener">${R.icon(
        'external',
        14
      )}</a>
    <button class="btn btn-ghost btn-sm" type="button" data-action="delete" data-resource="pages" data-id="${
      p.id
    }" data-confirm="确定删除页面「${R.escAttr(p.title)}」吗？历史版本也会一并删除。">${R.icon('trash', 14)}</button>
  </td>
</tr>`;
    })
    .join('');

  return `<div class="table-wrap">
  <div class="table-scroll">
    <table class="data">
      <thead><tr>
        <th>页面</th><th>格式</th><th>皮肤</th><th>状态</th><th>导航</th><th>更新</th><th class="col-act">操作</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  ${
    list.length
      ? ''
      : `<div class="empty" style="border:0;border-radius:0">${R.icon('file', 32)}<p>还没有自建页面。点右上角「新建页面」开始。</p></div>`
  }
</div>`;
}

module.exports = { pageEditor, pageList, TOOLBAR };
