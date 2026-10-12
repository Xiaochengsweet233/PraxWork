'use strict';
/**
 * 表单系统：可自定义字段（填空 / 单选 / 多选 / 下拉 / 数字 / 邮箱 / 日期 / 评分等）
 *
 * 数据模型：
 *   forms            表单定义（fields 为 JSON 数组）
 *   form_submissions 提交记录（data 为 JSON 对象）
 *
 * 字段类型：
 *   text      单行填空
 *   textarea  多行填空
 *   number    数字
 *   email     邮箱
 *   tel       电话
 *   date      日期
 *   radio     单选
 *   checkbox  多选
 *   select    下拉
 *   rating    评分（1~5 星）
 *
 * 安全：所有字段名用 k_<n> 内部命名，标签与选项输出前转义；
 *       提交数据只存字符串，前台渲染时按类型回显。
 */

const R = require('./render');
const { parseJSON } = require('./db');

/* ---------------------------------------------------------------- 字段类型定义 */

const FIELD_TYPES = [
  { key: 'text', label: '单行填空', icon: 'pencil' },
  { key: 'textarea', label: '多行填空', icon: 'file' },
  { key: 'number', label: '数字', icon: 'chart' },
  { key: 'email', label: '邮箱', icon: 'mail' },
  { key: 'tel', label: '电话', icon: 'mail' },
  { key: 'date', label: '日期', icon: 'clock' },
  { key: 'radio', label: '单选题', icon: 'target' },
  { key: 'checkbox', label: '多选题', icon: 'list' },
  { key: 'select', label: '下拉选择', icon: 'chevronDown' },
  { key: 'rating', label: '评分（1~5星）', icon: 'sparkle' },
];

const TYPE_NEEDS_OPTIONS = new Set(['radio', 'checkbox', 'select']);

/** 字段默认结构 */
function emptyField(type, index) {
  const base = {
    key: 'f' + index,
    type: type || 'text',
    label: '',
    required: false,
    placeholder: '',
    help: '',
  };
  if (TYPE_NEEDS_OPTIONS.has(base.type)) {
    base.options = ['选项一', '选项二', '选项三'];
  }
  if (base.type === 'rating') {
    base.max = 5;
  }
  return base;
}

/** 规范化字段列表（容错：字段名非对象则丢弃，缺 key 自动补） */
function normalizeFields(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((f) => f && typeof f === 'object')
    .map((f, i) => {
      const t = FIELD_TYPES.some((x) => x.key === f.type) ? f.type : 'text';
      const out = {
        key: f.key || 'f' + i,
        type: t,
        label: String(f.label || '').slice(0, 120),
        required: !!f.required,
        placeholder: String(f.placeholder || '').slice(0, 200),
        help: String(f.help || '').slice(0, 300),
      };
      if (TYPE_NEEDS_OPTIONS.has(t)) {
        out.options = Array.isArray(f.options) ? f.options.map((o) => String(o).slice(0, 120)) : [];
      }
      if (t === 'rating') {
        const m = Number(f.max);
        out.max = Number.isFinite(m) && m >= 2 && m <= 10 ? Math.round(m) : 5;
      }
      return out;
    });
}

/* ---------------------------------------------------------------- 前台渲染 */

/** 把单个字段渲染成前台 HTML（表单内） */
function renderField(f) {
  // 字段 key 就是表单字段的 name，直接使用，不再二次加前缀
  const name = f.key;
  const req = f.required ? ' required' : '';
  const placeholder = f.placeholder ? ` placeholder="${R.escAttr(f.placeholder)}"` : '';
  const help = f.help ? `<div class="form-help">${R.esc(f.help)}</div>` : '';
  const label = `<label class="form-label" for="${R.escAttr(name)}">${R.esc(f.label)}${
    f.required ? '<span class="form-req">*</span>' : ''
  }</label>`;

  let input = '';
  switch (f.type) {
    case 'textarea':
      input = `<textarea class="input textarea" id="${R.escAttr(name)}" name="${R.escAttr(
        name
      )}"${placeholder}${req} rows="4"></textarea>`;
      break;
    case 'radio':
      input =
        `<div class="form-options">` +
        (f.options || [])
          .map(
            (o, i) =>
              `<label class="form-opt"><input type="radio" name="${R.escAttr(name)}" value="${R.escAttr(
                o
              )}"${req && i === 0 ? ' required' : ''}><span>${R.esc(o)}</span></label>`
          )
          .join('') +
        `</div>`;
      break;
    case 'checkbox':
      input =
        `<div class="form-options">` +
        (f.options || [])
          .map(
            (o) =>
              `<label class="form-opt"><input type="checkbox" name="${R.escAttr(name)}[]" value="${R.escAttr(
                o
              )}"><span>${R.esc(o)}</span></label>`
          )
          .join('') +
        `</div>`;
      break;
    case 'select':
      input =
        `<select class="select" id="${R.escAttr(name)}" name="${R.escAttr(name)}"${req}>` +
        `<option value="">请选择…</option>` +
        (f.options || []).map((o) => `<option value="${R.escAttr(o)}">${R.esc(o)}</option>`).join('') +
        `</select>`;
      break;
    case 'rating':
      input =
        `<div class="form-rating" data-rating-name="${R.escAttr(name)}">` +
        Array.from({ length: f.max || 5 }, (_, i) => i + 1)
          .map(
            (n) =>
              `<label class="form-star"><input type="radio" name="${R.escAttr(name)}" value="${n}"${
                req && n === (f.max || 5) ? ' required' : ''
              }><span>${'★'.repeat(n)}</span></label>`
          )
          .join('') +
        `</div>`;
      break;
    default:
      // text / number / email / tel / date
      const type = f.type === 'text' ? 'text' : f.type;
      input = `<input class="input" type="${R.escAttr(type)}" id="${R.escAttr(name)}" name="${R.escAttr(
        name
      )}"${placeholder}${req}>`;
      break;
  }

  return `<div class="form-field" data-field-type="${R.escAttr(f.type)}">${label}${input}${help}</div>`;
}

/** 渲染完整前台表单 */
function renderPublicForm(form) {
  const fields = normalizeFields(form.fields);
  if (!fields.length) {
    return `<div class="empty">${R.icon('file', 32)}<p>这个表单还没有可填写的字段。</p></div>`;
  }

  const body = fields.map(renderField).join('\n');

  return `<form class="form-view" id="publicForm" data-form-slug="${R.escAttr(form.slug)}" data-allow-multiple="${
    form.allow_multiple ? '1' : '0'
  }">
  ${
    form.description
      ? `<div class="form-desc">${R.nl2p(form.description)}</div>`
      : ''
  }
  ${body}
  <div class="form-error" id="formError" hidden></div>
  <div class="form-actions">
    <button class="btn btn-primary btn-lg" type="submit">${R.icon('check', 18)}提交</button>
  </div>
  <div class="form-success" id="formSuccess" hidden></div>
</form>`;
}

/* ---------------------------------------------------------------- 提交校验 */

/** 校验并归一化提交数据。返回 { ok, data, error } */
function validateSubmission(fields, input) {
  const out = {};
  const src = input || {};

  for (const f of fields) {
    const name = f.key;
    let v = src[name];

    // checkbox 多选是数组
    if (f.type === 'checkbox') {
      const arr = Array.isArray(v) ? v : v ? [v] : [];
      const cleaned = arr.map((x) => String(x).slice(0, 200)).filter(Boolean);
      if (f.required && !cleaned.length) {
        return { ok: false, error: `请至少选择一项：${f.label || '必填项'}` };
      }
      out[name] = cleaned;
      continue;
    }

    const s = Array.isArray(v) ? v[0] : v;
    const str = String(s === undefined || s === null ? '' : s).trim();

    if (f.required && !str) {
      return { ok: false, error: `请填写：${f.label || '必填项'}` };
    }

    // 类型校验
    if (str) {
      if (f.type === 'number' && !Number.isFinite(Number(str))) {
        return { ok: false, error: `「${f.label || '数字项'}」必须是数字` };
      }
      if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
        return { ok: false, error: `「${f.label || '邮箱'}」格式不正确` };
      }
      if (f.type === 'rating') {
        const n = Number(str);
        if (!Number.isInteger(n) || n < 1 || n > (f.max || 5)) {
          return { ok: false, error: `「${f.label || '评分'}」取值无效` };
        }
      }
    }

    out[name] = str.slice(0, 2000);
  }

  return { ok: true, data: out };
}

/* ---------------------------------------------------------------- 后台：字段构建器 */

/** 后台表单编辑界面 */
function formEditor(form) {
  const isEdit = !!form && form.id;
  const r = form || {
    title: '',
    slug: '',
    description: '',
    success_msg: '提交成功，感谢你的参与！',
    allow_multiple: 1,
    enabled: 1,
    fields: [],
  };
  const fields = normalizeFields(r.fields);
  const fieldsJson = JSON.stringify(fields);

  return `
<form action="${isEdit ? `/api/forms/${r.id}` : '/api/forms'}"${isEdit ? ' data-method="PATCH"' : ''} id="formForm">
  <input type="hidden" name="fields" id="formFieldsJson" value="${R.escAttr(fieldsJson)}">

  <div class="form-editor">
    <!-- 左：表单设置 -->
    <div class="form-editor__side">
      <div class="panel">
        <div class="panel__head"><h3>表单设置</h3></div>
        <div class="panel__body">
          <div class="field">
            <label for="f_title">表单标题</label>
            <input class="input" id="f_title" name="title" required value="${R.escAttr(r.title)}" placeholder="例如：意见反馈">
          </div>
          <div class="field">
            <label for="f_slug">访问路径</label>
            <div class="input-group">
              <span class="input-group__prefix">/form/</span>
              <input class="input" id="f_slug" name="slug" value="${R.escAttr(r.slug)}" placeholder="feedback">
            </div>
            <div class="hint">留空自动生成；只能用字母、数字与连字符</div>
          </div>
          <div class="field">
            <label for="f_desc">表单说明</label>
            <textarea class="textarea" id="f_desc" name="description" style="min-height:80px" placeholder="放在表单顶部的说明文字">${R.esc(
              r.description
            )}</textarea>
          </div>
          <div class="field">
            <label for="f_success">提交成功提示</label>
            <input class="input" id="f_success" name="success_msg" value="${R.escAttr(r.success_msg)}">
          </div>
          <div class="field">
            <label class="check"><input type="hidden" name="allow_multiple" value="0"><input type="checkbox" name="allow_multiple" value="1"${
              r.allow_multiple ? ' checked' : ''
            }><span>允许重复提交</span></label>
            <label class="check"><input type="hidden" name="enabled" value="0"><input type="checkbox" name="enabled" value="1"${
              r.enabled ? ' checked' : ''
            }><span>启用（关闭后前台不可提交）</span></label>
          </div>
        </div>
        <div class="panel__foot">
          <button class="btn btn-primary" type="submit">${R.icon('check', 16)}${isEdit ? '保存表单' : '创建表单'}</button>
          <a class="btn btn-ghost" href="/admin/forms">返回列表</a>
          ${
            isEdit
              ? `<span class="toolbar__spacer"></span>
                 <a class="btn btn-ghost btn-sm" href="/form/${R.escAttr(r.slug)}" target="_blank" rel="noopener">${R.icon(
                   'external',
                   14
                 )}查看前台</a>`
              : ''
          }
        </div>
      </div>

      <div class="panel">
        <div class="panel__head"><h3>添加字段</h3></div>
        <div class="panel__body">
          <div class="form-type-list">
            ${FIELD_TYPES.map(
              (t) =>
                `<button class="form-type-btn" type="button" data-add-field="${R.escAttr(t.key)}">${R.icon(
                  t.icon,
                  15
                )}${R.esc(t.label)}</button>`
            ).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- 右：字段列表（拖拽排序由 JS 处理） -->
    <div class="form-editor__main">
      <div class="panel">
        <div class="panel__head">
          <h3>字段</h3>
          <span class="toolbar__spacer"></span>
          <span class="muted" style="font-size:12.5px">点击字段可编辑；拖拽手柄排序</span>
        </div>
        <div class="panel__body">
          <div class="form-builder" id="formBuilder"></div>
          <div class="empty" id="formBuilderEmpty">${R.icon('list', 32)}<p>还没有字段，从左侧「添加字段」开始。</p></div>
        </div>
      </div>
    </div>
  </div>
</form>

<!-- 字段编辑弹窗 -->
<div class="modal" id="fieldModal" role="dialog" aria-modal="true" aria-label="编辑字段">
  <div class="modal__veil" data-modal-close></div>
  <div class="modal__panel">
    <div class="modal__head">
      <h3>编辑字段</h3>
      <button class="modal__x" type="button" data-modal-close aria-label="关闭">${R.icon('close', 18)}</button>
    </div>
    <div class="modal__body" id="fieldModalBody"></div>
    <div class="modal__foot">
      <button class="btn btn-ghost" type="button" id="fieldModalDelete">${R.icon('trash', 15)}删除字段</button>
      <span class="toolbar__spacer"></span>
      <button class="btn btn-ghost" type="button" data-modal-close>取消</button>
      <button class="btn btn-primary" type="button" id="fieldModalSave">${R.icon('check', 15)}确定</button>
    </div>
  </div>
</div>
`;
}

/** 后台表单列表 */
function formList(list) {
  const rows = list
    .map((f) => {
      const fieldCount = normalizeFields(parseJSON(f.fields, [])).length;
      return `<tr>
  <td>
    <div class="t-title">${R.esc(f.title)}</div>
    <div class="t-sub mono">/form/${R.esc(f.slug)}</div>
  </td>
  <td><span class="badge badge-brand">${fieldCount} 个字段</span></td>
  <td>${f.enabled ? R.badge('ok', '启用') : R.badge('muted', '停用')}</td>
  <td><span class="muted" style="font-size:12.5px">${R.timeAgo(f.updated_at)}</span></td>
  <td class="col-act">
    <a class="btn btn-ghost btn-sm" href="/admin/forms/${f.id}">${R.icon('pencil', 14)}编辑</a>
    <a class="btn btn-ghost btn-sm" href="/admin/forms/${f.id}/submissions">${R.icon('list', 14)}提交</a>
    <a class="btn btn-ghost btn-sm" href="/form/${R.escAttr(f.slug)}" target="_blank" rel="noopener">${R.icon('external', 14)}</a>
    <button class="btn btn-ghost btn-sm" type="button" data-action="delete" data-resource="forms" data-id="${f.id}" data-confirm="确定删除表单「${R.escAttr(f.title)}」吗？其下所有提交记录也会一并删除。">${R.icon('trash', 14)}</button>
  </td>
</tr>`;
    })
    .join('');

  return `<div class="table-wrap">
  <div class="table-scroll">
    <table class="data">
      <thead><tr><th>表单</th><th>字段</th><th>状态</th><th>更新</th><th class="col-act">操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  ${
    list.length
      ? ''
      : `<div class="empty" style="border:0;border-radius:0">${R.icon('file', 32)}<p>还没有表单。点右上角「新建表单」开始。</p></div>`
  }
</div>`;
}

/** 提交记录列表 */
function submissionList(form, subs) {
  const fields = normalizeFields(form.fields);
  const labelByKey = {};
  fields.forEach((f) => (labelByKey[f.key] = f.label || f.key));

  if (!subs.length) {
    return `<div class="empty">${R.icon('list', 32)}<p>还没有收到任何提交。</p></div>`;
  }

  const rows = subs
    .map((s) => {
      const data = parseJSON(s.data, {});
      const cells = fields
        .map((f) => {
          const v = data[f.key];
          if (Array.isArray(v)) return `<td>${v.map((x) => R.esc(x)).join('、') || '<span class="muted">—</span>'}</td>`;
          return `<td>${v ? R.esc(String(v)) : '<span class="muted">—</span>'}</td>`;
        })
        .join('');
      return `<tr><td class="mono" style="font-size:12.5px">${R.fmtDate(s.created_at, true)}</td>${cells}<td><button class="btn btn-ghost btn-sm" type="button" data-action="delete" data-url="/api/form-submissions/${s.id}" data-confirm="确定删除这条提交吗？">${R.icon('trash', 13)}</button></td></tr>`;
    })
    .join('');

  const head = `<th>提交时间</th>` + fields.map((f) => `<th>${R.esc(f.label || '字段')}</th>`).join('') + `<th class="col-act">操作</th>`;

  return `<div class="table-wrap">
  <div class="table-scroll">
    <table class="data">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
}

module.exports = {
  FIELD_TYPES,
  TYPE_NEEDS_OPTIONS,
  emptyField,
  normalizeFields,
  renderField,
  renderPublicForm,
  validateSubmission,
  formEditor,
  formList,
  submissionList,
};
