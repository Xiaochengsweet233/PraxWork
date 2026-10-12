/* ==========================================================================
   表单构建器（后台）
   - 字段的增删改、拖拽排序
   - 保存前把字段序列化进隐藏域 #formFieldsJson
   - 前台表单的提交（/form/:slug 页面用）
   ========================================================================== */
(function () {
  'use strict';

  var D = document;
  var W = window;

  var TYPE_LABELS = {
    text: '单行填空', textarea: '多行填空', number: '数字', email: '邮箱',
    tel: '电话', date: '日期', radio: '单选', checkbox: '多选',
    select: '下拉', rating: '评分',
  };
  var TYPE_NEEDS_OPTIONS = { radio: 1, checkbox: 1, select: 1 };

  /* -------------------------------------------------- 构建器状态 */
  var builder = D.getElementById('formBuilder');
  var fieldsJson = D.getElementById('formFieldsJson');
  var empty = D.getElementById('formBuilderEmpty');
  if (builder && fieldsJson) {
    initBuilder();
  }

  function initBuilder() {
    var fields = parseFields();
    var dragIndex = null;

    render();

    function parseFields() {
      try {
        var v = JSON.parse(fieldsJson.value || '[]');
        return Array.isArray(v) ? v : [];
      } catch (_) {
        return [];
      }
    }

    function render() {
      var cards = builder.querySelectorAll('.form-builder-card');
      cards.forEach(function (c) { c.remove(); });
      var data = parseFields();
      if (empty) empty.hidden = data.length > 0;
      data.forEach(function (f, i) {
        builder.appendChild(cardEl(f, i));
      });
    }

    function cardEl(f, i) {
      var el = D.createElement('div');
      el.className = 'form-builder-card';
      el.setAttribute('draggable', 'true');
      el.setAttribute('data-index', i);
      var label = f.label || '（未命名字段）';
      var req = f.required ? '<span class="form-builder-card__req">必填</span>' : '';
      el.innerHTML =
        '<span class="form-builder-card__grip">⋮⋮</span>' +
        '<span class="form-builder-card__type">' + (TYPE_LABELS[f.type] || f.type) + '</span>' +
        '<span class="form-builder-card__label"></span>' +
        req +
        '<span class="form-builder-card__act">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-edit-field="' + i + '">编辑</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-del-field="' + i + '">' +
        '<svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>' +
        '</button>' +
        '</span>';
      el.querySelector('.form-builder-card__label').textContent = label;
      return el;
    }

    function saveFields(arr) {
      fieldsJson.value = JSON.stringify(arr);
    }

    /* 拖拽排序 */
    builder.addEventListener('dragstart', function (e) {
      var c = e.target.closest('.form-builder-card');
      if (!c) return;
      dragIndex = Number(c.getAttribute('data-index'));
      c.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    builder.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    builder.addEventListener('drop', function (e) {
      e.preventDefault();
      var c = e.target.closest('.form-builder-card');
      if (!c || dragIndex === null) return;
      var to = Number(c.getAttribute('data-index'));
      var arr = parseFields();
      var item = arr.splice(dragIndex, 1)[0];
      arr.splice(to, 0, item);
      saveFields(arr);
      dragIndex = null;
      render();
    });
    builder.addEventListener('dragend', function () {
      dragIndex = null;
      builder.querySelectorAll('.form-builder-card').forEach(function (x) {
        x.classList.remove('is-dragging');
      });
    });

    /* 增删改 */
    D.addEventListener('click', function (e) {
      var add = e.target.closest('[data-add-field]');
      if (add) {
        var arr = parseFields();
        arr.push({
          key: 'f' + Date.now(),
          type: add.getAttribute('data-add-field'),
          label: '',
          required: false,
          placeholder: '',
          help: '',
          options: TYPE_NEEDS_OPTIONS[add.getAttribute('data-add-field')] ? ['选项一', '选项二', '选项三'] : undefined,
          max: add.getAttribute('data-add-field') === 'rating' ? 5 : undefined,
        });
        // 去掉 undefined 属性
        arr = arr.map(function (f) { return JSON.parse(JSON.stringify(f)); });
        saveFields(arr);
        render();
        openEditor(arr.length - 1);
        return;
      }

      var edit = e.target.closest('[data-edit-field]');
      if (edit) {
        openEditor(Number(edit.getAttribute('data-edit-field')));
        return;
      }

      var del = e.target.closest('[data-del-field]');
      if (del) {
        var i = Number(del.getAttribute('data-del-field'));
        var arr2 = parseFields();
        arr2.splice(i, 1);
        saveFields(arr2);
        render();
        return;
      }
    });

    /* 字段编辑弹窗 */
    var editingIndex = null;

    function openEditor(i) {
      editingIndex = i;
      var f = parseFields()[i];
      if (!f) return;
      var body = D.getElementById('fieldModalBody');
      var typeSel = TYPE_LABELS;
      var typeOptions = Object.keys(typeSel).map(function (t) {
        return '<option value="' + t + '"' + (f.type === t ? ' selected' : '') + '>' + typeSel[t] + '</option>';
      }).join('');
      var needsOpts = TYPE_NEEDS_OPTIONS[f.type];
      var opts = (f.options || []).map(function (o) {
        return '<div class="field-edit-opt"><input class="input" type="text" data-opt-value="1" value="' +
          String(o).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '">' +
          '<button class="btn btn-ghost btn-sm" type="button" data-opt-del>×</button></div>';
      }).join('');
      var ratingRow = f.type === 'rating'
        ? '<div class="field-edit-row"><label class="label">最高分值</label><input class="input" type="number" id="fldMax" value="' + (f.max || 5) + '" min="2" max="10"></div>'
        : '';

      body.innerHTML =
        '<div class="field-edit-row"><label class="label">字段类型</label><select class="select" id="fldType">' + typeOptions + '</select></div>' +
        '<div class="field-edit-row"><label class="label">字段名称</label><input class="input" id="fldLabel" value="' +
        String(f.label || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '" placeholder="例如：你的昵称"></div>' +
        '<div class="field-edit-row"><label class="label">占位提示</label><input class="input" id="fldPlaceholder" value="' +
        String(f.placeholder || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"></div>' +
        '<div class="field-edit-row"><label class="label">帮助说明</label><input class="input" id="fldHelp" value="' +
        String(f.help || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"></div>' +
        '<div class="field-edit-row"><label class="check"><input type="checkbox" id="fldRequired"' + (f.required ? ' checked' : '') + '><span>必填项</span></label></div>' +
        '<div class="field-edit-row" id="fldOptionsRow" style="display:' + (needsOpts ? '' : 'none') + '">' +
        '<label class="label">选项（一行一个）</label><div class="field-edit-options" id="fldOptions">' + opts + '</div>' +
        '<button class="btn btn-ghost btn-sm" type="button" id="fldAddOpt">＋ 添加选项</button></div>' +
        ratingRow;

      W.praxModalOpen('fieldModal');

      // 类型切换时重渲染选项区
      var typeSelEl = D.getElementById('fldType');
      if (typeSelEl) {
        typeSelEl.addEventListener('change', function () {
          var t = typeSelEl.value;
          D.getElementById('fldOptionsRow').style.display = TYPE_NEEDS_OPTIONS[t] ? '' : 'none';
          var r = D.getElementById('fldMaxRow');
          var maxEl = D.getElementById('fldMax');
          if (t === 'rating') {
            if (!maxEl) {
              var row = D.createElement('div');
              row.className = 'field-edit-row';
              row.id = 'fldMaxRow';
              row.innerHTML = '<label class="label">最高分值</label><input class="input" type="number" id="fldMax" value="5" min="2" max="10">';
              D.getElementById('fldType').closest('.modal__body').appendChild(row);
            }
          } else if (maxEl) {
            maxEl.closest('.field-edit-row').remove();
          }
        });
      }

      var addOptBtn = D.getElementById('fldAddOpt');
      if (addOptBtn) {
        addOptBtn.addEventListener('click', function () {
          var box = D.getElementById('fldOptions');
          var d = D.createElement('div');
          d.className = 'field-edit-opt';
          d.innerHTML = '<input class="input" type="text" data-opt-value="1" value=""><button class="btn btn-ghost btn-sm" type="button" data-opt-del>×</button>';
          box.appendChild(d);
          d.querySelector('input').focus();
        });
      }

      D.getElementById('fldOptionsRow').addEventListener('click', function (e) {
        if (e.target.closest('[data-opt-del]')) {
          e.target.closest('.field-edit-opt').remove();
        }
      });
    }

    D.getElementById('fieldModalSave').addEventListener('click', function () {
      var arr = parseFields();
      var f = arr[editingIndex];
      if (!f) return;
      f.type = D.getElementById('fldType').value;
      f.label = D.getElementById('fldLabel').value.trim();
      f.placeholder = D.getElementById('fldPlaceholder').value.trim();
      f.help = D.getElementById('fldHelp').value.trim();
      f.required = D.getElementById('fldRequired').checked;
      if (TYPE_NEEDS_OPTIONS[f.type]) {
        f.options = Array.prototype.map.call(
          D.querySelectorAll('#fldOptions [data-opt-value]'),
          function (x) { return x.value.trim(); }
        ).filter(Boolean);
      } else {
        delete f.options;
      }
      if (f.type === 'rating') {
        var m = D.getElementById('fldMax');
        f.max = m ? Number(m.value) || 5 : 5;
      } else {
        delete f.max;
      }
      saveFields(arr);
      render();
      W.praxModalClose(D.getElementById('fieldModal'));
    });

    D.getElementById('fieldModalDelete').addEventListener('click', function () {
      if (!W.confirm('删除这个字段吗？')) return;
      var arr = parseFields();
      arr.splice(editingIndex, 1);
      saveFields(arr);
      render();
      W.praxModalClose(D.getElementById('fieldModal'));
    });
  }

  /* -------------------------------------------------- 前台表单提交 */
  var publicForm = D.getElementById('publicForm');
  if (publicForm) {
    var slug = publicForm.getAttribute('data-form-slug');
    publicForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var err = D.getElementById('formError');
      var ok = D.getElementById('formSuccess');
      var btn = publicForm.querySelector('[type=submit]');
      err.hidden = true;
      ok.hidden = true;

      var payload = {};
      var fd = new FormData(publicForm);
      fd.forEach(function (v, k) {
        if (k.slice(-2) === '[]') {
          var key = k.slice(0, -2);
          if (!payload[key]) payload[key] = [];
          payload[key].push(v);
        } else {
          payload[k] = v;
        }
      });

      // 收集 rating 的选中值（radio 同 name）
      if (btn) btn.classList.add('is-disabled');

      W.praxApi('/api/forms/' + slug + '/submit', { method: 'POST', body: payload })
        .then(function (r) {
          ok.textContent = r.message || '提交成功，感谢你的参与！';
          ok.hidden = false;
          publicForm.reset();
          publicForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
        })
        .catch(function (e2) {
          err.textContent = e2.message || '提交失败，请稍后重试';
          err.hidden = false;
        })
        .finally(function () {
          if (btn) btn.classList.remove('is-disabled');
        });
    });
  }
})();
