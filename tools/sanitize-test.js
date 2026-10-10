'use strict';
/**
 * HTML 正文清洗器自检
 * 关注点：白名单是否真的挡住脚本、内联事件、危险协议；同时不误伤正常排版。
 *
 * 用法：node tools/sanitize-test.js
 */

const c = require('../server/content');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${extra ? '\n      ' + extra : ''}`);
  }
}

function blocked(name, input, needle) {
  const out = c.sanitizeHtml(input);
  ok(name, !out.toLowerCase().includes(needle.toLowerCase()), '输出: ' + out);
}

function kept(name, input, needle) {
  const out = c.sanitizeHtml(input);
  ok(name, out.toLowerCase().includes(needle.toLowerCase()), '输出: ' + out);
}

console.log('\n=== HTML 清洗器自检 ===\n');

console.log('[必须拦掉的]');
blocked('script 标签', '<p>a</p><script>alert(1)</script><p>b</p>', '<script');
blocked('script 内容', '<script>alert(1)</script>', 'alert(1)');
blocked('大写 SCRIPT', '<SCRIPT>alert(1)</SCRIPT>', 'alert(1)');
blocked('嵌套绕过 scr<script>ipt', '<scr<script>ipt>alert(1)</scr</script>ipt>', '<script');
blocked('img onerror', '<img src="x" onerror="alert(1)">', 'onerror');
blocked('onload', '<div onload="alert(1)">x</div>', 'onload');
blocked('onclick', '<a href="#" onclick="alert(1)">x</a>', 'onclick');
blocked('javascript: href', '<a href="javascript:alert(1)">x</a>', 'javascript:');
blocked('大小写 JaVaScRiPt', '<a href="JaVaScRiPt:alert(1)">x</a>', 'javascript');
blocked('iframe', '<iframe src="//evil.com"></iframe>', '<iframe');
blocked('object', '<object data="x"></object>', '<object');
blocked('embed', '<embed src="x">', '<embed');
blocked('form', '<form action="/x"><input name="a"></form>', '<form');
blocked('input', '<input type="text">', '<input');
blocked('button', '<button>点</button>', '<button');
blocked('svg onload', '<svg onload="alert(1)"></svg>', 'onload');
blocked('math', '<math><mtext>x</mtext></math>', '<math');
blocked('meta refresh', '<meta http-equiv="refresh" content="0;url=//evil.com">', '<meta');
blocked('link 引入外部样式', '<link rel="stylesheet" href="//evil.com/x.css">', '<link');
blocked('base 标签', '<base href="//evil.com">', '<base');
blocked('style 中的 expression', '<style>div{width:expression(alert(1))}</style>', 'expression');
blocked('style 中的 @import', '<style>@import url("//evil.com/x.css");</style>', '@import');
blocked('style 中的 javascript:', '<style>div{background:url(javascript:alert(1))}</style>', 'javascript');
blocked('注释里藏脚本', '<!-- <script>alert(1)</script> -->', 'alert(1)');
blocked('DOCTYPE', '<!DOCTYPE html><p>x</p>', '<!DOCTYPE');
blocked('src 用非图片 data:', '<img src="data:text/html;base64,PHNjcmlwdD4=">', 'data:text/html');
blocked('srcdoc', '<div srcdoc="<script>alert(1)</script>">x</div>', 'srcdoc');
blocked('formaction', '<button formaction="//evil.com">x</button>', 'formaction');
blocked('video 的 javascript: src', '<video src="javascript:alert(1)"></video>', 'javascript:');
blocked('video 的 data: src', '<video src="data:video/mp4;base64,xxx"></video>', 'data:video');

console.log('\n[必须保留的：正常排版]');
kept('普通段落', '<p>你好</p>', '<p>你好</p>');
kept('标题', '<h2>标题</h2>', '<h2>标题</h2>');
kept('div + class', '<div class="box">内容</div>', 'class="box"');
kept('内联 style', '<p style="color:#c34c18">橙色</p>', 'color:#c34c18');
kept('列表', '<ul><li>a</li><li>b</li></ul>', '<li>a</li>');
kept('表格', '<table><tr><td>1</td></tr></table>', '<td>1</td>');
kept('colspan', '<td colspan="2">x</td>', 'colspan="2"');
kept('图片', '<img src="/assets/img/hero-portal.jpg" alt="主视觉">', 'src="/assets/img/hero-portal.jpg"');
kept('允许 data:image', '<img src="data:image/png;base64,iVBORw0KGgo=">', 'data:image/png');
kept('站内链接', '<a href="/atelier">工坊</a>', 'href="/atelier"');
kept('外链自动补 rel', '<a href="https://a.com">外</a>', 'rel="noopener noreferrer"');
kept('br / hr', '<br><hr>', '<br>');
kept('details/summary', '<details><summary>展开</summary>内容</details>', '<summary>展开</summary>');
kept('style 标签保留（内部已过滤）', '<style>.a{color:red}</style>', '.a{color:red}');
kept('中文与实体', '<p>橙曦澎湃 &amp; Prax</p>', '橙曦澎湃');
kept('视频 video + source', '<video controls><source src="/uploads/a.mp4" type="video/mp4"></video>', 'src="/uploads/a.mp4"');
kept('视频外链', '<video src="https://example.com/a.mp4" controls></video>', 'src="https://example.com/a.mp4"');
kept('音频 audio', '<audio src="/uploads/a.mp3" controls></audio>', 'src="/uploads/a.mp3"');
kept('视频 controls 属性', '<video src="/uploads/a.mp4" controls muted loop playsinline></video>', 'controls');

console.log('\n[边界情况]');
ok('空输入', c.sanitizeHtml('') === '');
ok('null 输入', c.sanitizeHtml(null) === '');
ok('undefined 输入', c.sanitizeHtml(undefined) === '');
ok('纯文本原样', c.sanitizeHtml('就是文字') === '就是文字');
ok('未闭合标签不崩溃', typeof c.sanitizeHtml('<div>abc') === 'string');
ok('大量标签不崩溃', typeof c.sanitizeHtml('<p>x</p>'.repeat(2000)) === 'string');

console.log('\n[格式归一化]');
ok('markdown 识别', c.normalizeFormat('markdown') === 'markdown');
ok('html 识别', c.normalizeFormat('html') === 'html');
ok('大小写不敏感', c.normalizeFormat('HTML') === 'html');
ok('未知格式回退 markdown', c.normalizeFormat('weird') === 'markdown');
ok('空值回退 markdown', c.normalizeFormat('') === 'markdown');

console.log('\n[renderBody 分流]');
const mdOut = c.renderBody('**粗**', 'markdown');
ok('markdown 走渲染器', mdOut.includes('<strong>粗</strong>'), mdOut);
const mdXss = c.renderBody('<script>alert(1)</script>', 'markdown');
ok('markdown 里的脚本被转义', !mdXss.includes('<script>') && mdXss.includes('&lt;script'), mdXss);
const htmlOut = c.renderBody('<p style="color:red">红</p>', 'html');
ok('html 原样保留样式', htmlOut.includes('color:red'), htmlOut);
const htmlXss = c.renderBody('<p onclick="alert(1)">x</p><script>bad()</script>', 'html');
ok('html 里的脚本被清洗', !htmlXss.includes('<script') && !htmlXss.includes('onclick'), htmlXss);

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
if (failures.length) {
  console.log('\n失败项：');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('');
process.exit(fail ? 1 : 0);
