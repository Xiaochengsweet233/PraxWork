'use strict';
/**
 * 页面正文渲染：把「Markdown」或「HTML」格式的正文转成前台 HTML。
 *
 * 安全模型（整个自建页面功能的边界就在这里）：
 *   - markdown：先转义、再套格式。正文里的 <script> 之类只会显示成文字。
 *   - html    ：按用户书写的原始 HTML 输出（这是"自创网站"的能力所在），
 *               但**只有拥有 content 权限的登录用户**才能创建/修改 HTML 页面，
 *               且每次保存都会写审计日志。见 routes/admin.js 的校验。
 *   - 两种格式都会再过一遍「危险片段清洗」，拦掉脚本、内联事件、
 *     javascript: 协议与 iframe/object/embed 等可执行嵌入。
 *
 * 换句话说：HTML 模式给的是"能排版、能嵌样式"的自由，
 * 而不是"能任意执行脚本"的自由 —— 权限 + 清洗 + 审计 三道闸。
 */

const md = require('./markdown');

/** 允许的标签白名单（HTML 模式用） */
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'audio', 'b', 'bdi', 'bdo', 'blockquote', 'br',
  'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div',
  'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'label', 'li', 'main', 'mark',
  'nav', 'ol', 'p', 'picture', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section',
  'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'track', 'u', 'ul', 'var',
  'video', 'wbr',
  // 明确禁止：script, iframe, object, embed, form, input, button, textarea,
  //           select, option, link, meta, base, svg, math, canvas
  // 视频/音频通过 <video>/<audio> + <source> 播放，src 只允许 http(s)/相对路径，
  // 不开放 iframe 嵌入（那是脚本执行与点击劫持的高危面）。
]);

/** 允许的属性白名单（按标签归组之外，用全局白名单 + 值检查更稳） */
const ALLOWED_ATTRS = new Set([
  'class', 'id', 'title', 'style', 'lang', 'dir', 'role',
  'href', 'target', 'rel',
  'src', 'alt', 'width', 'height', 'loading', 'decoding', 'srcset', 'sizes', 'media', 'type',
  'colspan', 'rowspan', 'scope', 'headers', 'start', 'reversed', 'value',
  'datetime', 'cite', 'open', 'download', 'referrerpolicy',
  // 媒体元素属性：视频/音频播放所需
  'controls', 'autoplay', 'muted', 'loop', 'playsinline', 'preload', 'poster',
]);

/** 明确禁止的属性名（即使不在名单里也二次兜底） */
function isForbiddenAttr(name) {
  const n = String(name).toLowerCase();
  if (n.startsWith('on')) return true; // onclick / onload / onerror ...
  if (n === 'srcdoc' || n === 'formaction' || n === 'action') return true;
  if (n === 'http-equiv' || n === 'content') return true;
  if (n === 'xlink:href' || n === 'xmlns') return true;
  return false;
}

/** 属性值里的危险内容 */
function isForbiddenValue(name, value) {
  const v = String(value || '');
  const n = String(name || '').toLowerCase();
  const probe = v.replace(/[\u0000-\u001f\u007f]/g, '').toLowerCase();
  if (/^\s*(javascript|vbscript|file|blob):/i.test(probe)) return true;
  if (/^\s*data:/i.test(probe) && n !== 'src' && n !== 'srcset') return true;
  if (/^\s*data:/i.test(probe) && n === 'src' && !/^data:image\//i.test(probe)) return true;
  // expression() / url(javascript:) 之类藏在 style 里的可执行写法
  if (n === 'style' && /(expression\s*\(|javascript:|behavior\s*:|@import)/i.test(probe)) return true;
  return false;
}

/**
 * 清洗 HTML 正文：
 *   1. 去掉注释、CDATA、DOCTYPE
 *   2. 去掉 <script>/<style> 之外的禁止标签（整对标签一起删）
 *   3. 逐个标签过滤：标签名不在白名单 -> 去掉标签本身；属性不在白名单或值危险 -> 去掉该属性
 *
 * 这里刻意采用「白名单 + 逐标签重写」而不是黑名单正则替换，
 * 因为黑名单很容易被 <scr<script>ipt> 这类嵌套写法绕过。
 */
function sanitizeHtml(input) {
  let html = String(input === null || input === undefined ? '' : input);

  // 去掉注释 / DOCTYPE / CDATA（注释里可能藏条件注释脚本）
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  html = html.replace(/<!DOCTYPE[^>]*>/gi, '');

  // 先整体移除高危区块（含内容），避免留下裸文本。
  // 注意：video/audio 已从历史高危名单里移除——它们通过 <source src> 播放，
  // src 在下方 safeUrl 收敛后只允许 http(s)/相对路径，不构成脚本执行面。
  // 过去把它们整块删掉，正是"用了视频/音频就整页变形"的根因。
  const killBlocks = ['script', 'iframe', 'object', 'embed', 'form', 'noscript', 'template', 'svg', 'math', 'canvas'];
  for (const tag of killBlocks) {
    const re = new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?<\\/' + tag + '\\s*>', 'gi');
    html = html.replace(re, '');
    // 自闭合或未闭合的单个标签
    html = html.replace(new RegExp('<' + tag + '\\b[^>]*\\/?>', 'gi'), '');
  }

  // <style> 的内容必须在这里一并过滤。
  // 早期版本把这一步拆成独立的 sanitizeStyles()，谁忘了调用就是一个漏洞面；
  // 现在合并成单一入口，调用 sanitizeHtml 就一定拿到了完整清洗。
  html = sanitizeStyles(html);

  // 逐标签重写
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^<>]*?)?)\/?>/g, (full, rawName, rawAttrs) => {
    const name = rawName.toLowerCase();
    const isClose = full.startsWith('</');

    if (!ALLOWED_TAGS.has(name)) return ''; // 整块标签丢弃，保留其文本内容
    if (isClose) return '</' + name + '>';

    const attrs = [];
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    while ((m = attrRe.exec(rawAttrs))) {
      const attrName = m[1].toLowerCase();
      const rawVal = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';

      if (!ALLOWED_ATTRS.has(attrName)) continue;
      if (isForbiddenAttr(attrName)) continue;
      if (isForbiddenValue(attrName, rawVal)) continue;

      // href/src 再做一次协议收敛；媒体源（video/audio/source）额外允许视频/音频扩展名
      if (attrName === 'href' || attrName === 'src') {
        const isMedia =
          name === 'video' || name === 'audio' || name === 'source' || name === 'track';
        const safe = md.safeUrl(rawVal, { image: attrName === 'src', media: isMedia });
        if (!safe) continue;
        attrs.push(attrName + '="' + md.escapeHtml(safe) + '"');
        continue;
      }
      attrs.push(attrName + '="' + md.escapeHtml(rawVal) + '"');
    }

    // 外链补 noopener
    if (name === 'a') {
      const hrefAttr = attrs.find((a) => a.startsWith('href='));
      if (hrefAttr && /^href="(https?:)?\/\//i.test(hrefAttr)) {
        if (!attrs.some((a) => a.startsWith('rel='))) {
          attrs.push('rel="noopener noreferrer"');
        }
        if (!attrs.some((a) => a.startsWith('target='))) {
          attrs.push('target="_blank"');
        }
      }
    }

    // 输出保持 HTML 兼容：<br>、<img src="..."> 这种写法浏览器都能正确解析；
    // 不强行转成自闭合 <br/>，以免与既有测试与前端预期不一致。
    return '<' + name + (attrs.length ? ' ' + attrs.join(' ') : '') + '>';
  });
}

/** <style> 内容也要过滤：拦掉 @import 与表达式，避免外链样式与可执行样式。
 *  注意：已由 sanitizeHtml 内部调用，一般不需要单独调。 */
function sanitizeStyles(html) {
  return String(html).replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (m, css) => {
    let out = String(css);
    out = out.replace(/@import[^;]*;?/gi, '');
    out = out.replace(/expression\s*\([^)]*\)/gi, '');
    out = out.replace(/behavior\s*:[^;]*;?/gi, '');
    out = out.replace(/javascript\s*:/gi, '');
    out = out.replace(/<\/?[a-z][^>]*>/gi, ''); // style 里不该有标签
    return '<style>' + out + '</style>';
  });
}

const FORMATS = new Set(['markdown', 'html']);

function normalizeFormat(f) {
  const v = String(f || '').toLowerCase();
  return FORMATS.has(v) ? v : 'markdown';
}

/**
 * 渲染页面正文。
 * @param {string} body
 * @param {string} format  'markdown' | 'html'
 * @returns {string} 可直接输出的 HTML
 */
function renderBody(body, format) {
  if (normalizeFormat(format) === 'html') {
    // sanitizeHtml 内部已包含 style 内容过滤，这里不再重复调用
    return sanitizeHtml(body);
  }
  return md.render(body);
}

module.exports = {
  renderBody,
  sanitizeHtml,
  sanitizeStyles,
  normalizeFormat,
  FORMATS,
  ALLOWED_TAGS,
  ALLOWED_ATTRS,
};
