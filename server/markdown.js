'use strict';
/**
 * 轻量 Markdown 渲染器（零依赖）
 *
 * 为什么自己写而不引第三方库：
 *   1. 需要精确控制 HTML 转义 —— 见下方「安全模型」，这是本站点的安全边界；
 *   2. 保持零依赖，Docker 镜像与安装体积都小；
 *   3. 门户内容所需的是 Markdown 的一个明确子集，不需要完整 CommonMark。
 *
 * 安全模型（重要）：
 *   所有文本一律先经过 escapeHtml 再套用格式，因此**原始 HTML 永远不会被解析**。
 *   想嵌入自定义 HTML 时，必须把页面格式显式切成「HTML」——
 *   那是一条看得见、有权限校验、会记审计日志的路径，而不是藏在 Markdown 里的后门。
 *
 * 支持范围（刻意收敛，写进文档）：
 *   标题 # ~ ######、粗体、斜体、粗斜体、删除线、行内代码、围栏代码块、
 *   链接、图片、裸链接自动识别、无序/有序列表（支持嵌套）、引用、分隔线、
 *   GFM 管道表格、以及单换行转 <br>（便于中文排版）。
 */

/** HTML 转义：所有用户文本的唯一出口 */
function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * URL 白名单：拦住可执行协议。
 * 图片额外允许 data:image/*（内联小图标有用），其余 data: 一律拦掉。
 */
function safeUrl(raw, { image = false } = {}) {
  const u = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!u) return '';
  // 去掉可能用于绕过的控制字符
  const probe = u.replace(/[\u0000-\u001f\u007f]/g, '');
  if (/^(javascript|vbscript|file|blob):/i.test(probe)) return '';
  if (/^data:/i.test(probe)) {
    return image && /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);/i.test(probe) ? u : '';
  }
  return u;
}

/** 代码块占位符：用不可打印字符包裹，保证不会被后续转义与格式规则破坏 */
const PH_OPEN = '\u0000';
const PH_CLOSE = '\u0001';

function placeholder(store, html) {
  const i = store.push(html) - 1;
  return PH_OPEN + i + PH_CLOSE;
}

function restore(html, store) {
  return html.replace(new RegExp(PH_OPEN + '(\\d+)' + PH_CLOSE, 'g'), (m, i) => store[Number(i)] ?? '');
}

/* ---------------------------------------------------------------- 行内 */

function inline(text, opts = {}) {
  const breaks = opts.breaks !== false;
  const store = [];

  let s = String(text === null || text === undefined ? '' : text);

  // 1) 先取出行内代码，避免其中的 * _ [ ] 被当成格式
  s = s.replace(/(`+)([\s\S]*?)\1/g, (m, ticks, code) => {
    return placeholder(store, '<code>' + escapeHtml(code.replace(/^ | $/g, '')) + '</code>');
  });

  // 2) 转义所有剩余的 HTML —— 这一步之后，原文里的标签已无法生效
  s = escapeHtml(s);

  // 3) 图片 ![alt](url)
  // URL 允许一层括号嵌套，例如 (https://a.com/x_(1).png)，
  // 否则遇到 `javascript:alert(1)` 这类带括号的地址会只吃掉一半、留下一个孤立的 `)`。
  s = s.replace(
    /!\[([^\]]*)\]\(\s*((?:[^\s()]|\([^\s()]*\))+)(?:\s+&quot;([^&]*)&quot;)?\s*\)/g,
    (m, alt, url, title) => {
      const u = safeUrl(url, { image: true });
      if (!u) return escapeHtml(alt);
      const t = title ? ' title="' + escapeHtml(title) + '"' : '';
      return placeholder(
        store,
        '<img src="' + escapeHtml(u) + '" alt="' + escapeHtml(alt) + '"' + t + ' loading="lazy" decoding="async">'
      );
    }
  );

  // 4) 链接 [text](url)
  s = s.replace(
    /\[([^\]]+)\]\(\s*((?:[^\s()]|\([^\s()]*\))+)(?:\s+&quot;([^&]*)&quot;)?\s*\)/g,
    (m, label, url, title) => {
      const u = safeUrl(url);
      if (!u) return label;
      const t = title ? ' title="' + escapeHtml(title) + '"' : '';
      // 外链自动加 noopener
      const ext = /^(https?:)?\/\//i.test(u) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return '<a href="' + escapeHtml(u) + '"' + t + ext + '>' + label + '</a>';
    }
  );

  // 5) 裸链接自动识别（在转义后处理，& 仍是实体，作为 href 是合法的）
  s = s.replace(/(^|[\s(（])((?:https?:\/\/|www\.)[^\s<）)]+[^\s<）).,;:!?])/g, (m, pre, url) => {
    const href = /^www\./i.test(url) ? 'http://' + url : url;
    const u = safeUrl(href);
    if (!u) return m;
    return pre + '<a href="' + escapeHtml(u) + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
  });

  // 6) 粗体 / 斜体 / 删除线
  s = s.replace(/\*\*\*([^\s*][\s\S]*?[^\s*]|\S)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^\s*][\s\S]*?[^\s*]|\S)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^\s_][\s\S]*?[^\s_]|\S)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^\s*][\s\S]*?[^\s*]|\S)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^\s_][\s\S]*?[^\s_]|\S)_(?!_)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^\s~][\s\S]*?[^\s~]|\S)~~/g, '<del>$1</del>');

  // 7) 单换行→<br>（中文内容按行折行更符合直觉）
  if (breaks) s = s.replace(/\n/g, '<br>\n');

  return restore(s, store);
}

/* ---------------------------------------------------------------- 表格 */

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(row) {
  let r = String(row).trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|')) r = r.slice(0, -1);
  return r.split('|').map((c) => c.trim());
}

function tryTable(lines, i) {
  if (i + 1 >= lines.length) return null;
  if (!lines[i].includes('|')) return null;
  if (!TABLE_SEP.test(lines[i + 1])) return null;

  const head = splitRow(lines[i]);
  const aligns = splitRow(lines[i + 1]).map((c) => {
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
  });

  const body = [];
  let j = i + 2;
  while (j < lines.length && lines[j].includes('|') && lines[j].trim()) {
    body.push(splitRow(lines[j]));
    j++;
  }

  const th = head
    .map((c, k) => '<th' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inline(c) + '</th>')
    .join('');
  const rows = body
    .map(
      (r) =>
        '<tr>' +
        head
          .map(
            (_, k) =>
              '<td' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inline(r[k] || '') + '</td>'
          )
          .join('') +
        '</tr>'
    )
    .join('');

  return { html: '<table><thead><tr>' + th + '</tr></thead><tbody>' + rows + '</tbody></table>', next: j };
}

/* ---------------------------------------------------------------- 列表 */

const LIST_MARKER = /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*)$/;

function parseList(lines, start) {
  const first = LIST_MARKER.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let cur = null;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    const m = LIST_MARKER.exec(line);

    if (m) {
      const ind = m[1].length;
      const isOrdered = /\d/.test(m[2]);

      if (ind < baseIndent) break;

      // 同级但换了列表类型 -> 交给上层开新列表
      if (ind === baseIndent && isOrdered !== ordered) break;

      // 同级同类 -> 开新条目
      if (ind === baseIndent) {
        if (cur) items.push(cur);
        cur = [m[3] || ''];
        i++;
        continue;
      }

      // 更深缩进 -> 视为当前条目的一部分（交给递归渲染出嵌套列表）
      if (cur) cur.push(line.slice(Math.min(line.length, baseIndent + 2)));
      i++;
      continue;
    }

    if (!line.trim()) {
      // 空行：向后看，判断列表是否继续
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length) {
        i = j;
        break;
      }
      const nm = LIST_MARKER.exec(lines[j]);
      const nextIndent = lines[j].length - lines[j].trimStart().length;
      if ((nm && nm[1].length >= baseIndent) || nextIndent >= baseIndent + 2) {
        if (cur) cur.push('');
        i = j;
        continue;
      }
      break;
    }

    const ind = line.length - line.trimStart().length;
    if (ind >= baseIndent + 2) {
      if (cur) cur.push(line.slice(baseIndent + 2));
      i++;
      continue;
    }

    // 惰性延续：没缩进的普通行归到当前条目
    if (cur) {
      cur.push(line);
      i++;
      continue;
    }
    break;
  }

  if (cur) items.push(cur);

  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && /\d/.test(first[2]) && parseInt(first[2], 10) !== 1 ? ' start="' + parseInt(first[2], 10) + '"' : '';
  const body = items
    .map((itemLines) => '<li>' + parseBlocks(itemLines.join('\n')) + '</li>')
    .join('');

  return { html: '<' + tag + startAttr + '>' + body + '</' + tag + '>', next: i };
}

/* ---------------------------------------------------------------- 块级 */

function parseBlocks(src) {
  const lines = String(src === null || src === undefined ? '' : src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    // 围栏代码块
    const fence = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const lang = fence[2] || '';
      const buf = [];
      i++;
      while (i < lines.length && !new RegExp('^\\s*' + marker + '{3,}\\s*$').test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾围栏
      const cls = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
      out.push('<pre><code' + cls + '>' + escapeHtml(buf.join('\n')) + '</code></pre>');
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // ATX 标题
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const lv = h[1].length;
      out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
      i++;
      continue;
    }

    // 表格（要在列表之前判断，避免 | 开头的行被误吃）
    const tbl = tryTable(lines, i);
    if (tbl) {
      out.push(tbl.html);
      i = tbl.next;
      continue;
    }

    // 引用
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && (/^\s*>/.test(lines[i]) || (buf.length && lines[i].trim() && !LIST_MARKER.exec(lines[i])))) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + parseBlocks(buf.join('\n')) + '</blockquote>');
      continue;
    }

    // 列表
    if (LIST_MARKER.exec(line)) {
      const r = parseList(lines, i);
      out.push(r.html);
      i = r.next;
      continue;
    }

    // 段落：吃到空行或下一个块级起始
    const buf = [line];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) break;
      if (/^\s*(`{3,}|~{3,})/.test(l)) break;
      if (/^(#{1,6})\s+/.test(l)) break;
      if (/^\s*>/.test(l)) break;
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) break;
      if (LIST_MARKER.exec(l)) break;
      if (tryTable(lines, i)) break;
      buf.push(l);
      i++;
    }
    out.push('<p>' + inline(buf.join('\n')) + '</p>');
  }

  return out.join('\n');
}

/**
 * 渲染 Markdown。
 * @param {string} src
 * @param {{breaks?: boolean}} [opts]
 * @returns {string} 安全的 HTML
 */
function render(src, opts = {}) {
  const html = parseBlocks(src);
  return html;
}

module.exports = { render, escapeHtml, safeUrl, inline };
