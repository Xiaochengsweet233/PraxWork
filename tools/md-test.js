'use strict';
/**
 * Markdown 渲染器自检
 * 重点覆盖两块：功能正确性 + 安全性（原始 HTML / 危险协议必须被拦住）
 *
 * 用法：node tools/md-test.js
 */

const md = require('../server/markdown');

let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  const a = String(actual);
  const e = String(expected);
  if (a === e) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      实际: ${a}\n      期望: ${e}`);
  }
}

function has(name, haystack, needle) {
  if (String(haystack).includes(needle)) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      内容: ${haystack}\n      应包含: ${needle}`);
  }
}

function notHas(name, haystack, needle) {
  if (!String(haystack).includes(needle)) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      不应包含: ${needle}\n      实际: ${haystack}`);
  }
}

console.log('\n=== Markdown 渲染器自检 ===\n');

/* ---------------------------------------------------------------- 安全性 */
console.log('[安全性：原始 HTML 必须被转义]');

eq('尖括号被转义', md.render('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
notHas('不会生成真实的 script 标签', md.render('<script>alert(1)</script>'), '<script>');

notHas('img onerror 被转义', md.render('<img src=x onerror=alert(1)>'), 'onerror=alert(1)>');
has('img 变成文本', md.render('<img src=x onerror=alert(1)>'), '&lt;img');

notHas('iframe 被转义', md.render('<iframe src="//evil.com"></iframe>'), '<iframe');

console.log('\n[安全性：危险协议]');
notHas('javascript: 链接被拦', md.render('[点我](javascript:alert(1))'), 'javascript:');
eq('javascript: 链接退化为纯文本', md.render('[点我](javascript:alert(1))'), '<p>点我</p>');

notHas('JaVaScRiPt: 大小写绕过被拦', md.render('[x](JaVaScRiPt:alert(1))'), 'alert(1)');
notHas('java\\tscript: 控制字符绕过被拦', md.render('[x](java\tscript:alert(1))'), 'javascript');

notHas('data: 非图片被拦', md.render('[x](data:text/html;base64,PHNjcmlwdD4=)'), 'data:text/html');
has('data:image 允许（内联小图）', md.render('![p](data:image/png;base64,iVBORw0KGgo=)'), 'data:image/png');
notHas('data:image/svg 里带脚本仍按图片处理但外链被拦', md.render('[x](data:image/png;base64,AAA)'), '<a href="data:');

notHas('图片 javascript: 被拦', md.render('![x](javascript:alert(1))'), 'javascript:');

console.log('\n[安全性：属性注入]');
notHas('alt 中的引号无法逃逸', md.render('![" onload="alert(1)](https://a.com/b.png)'), 'onload="alert(1)"');
notHas('链接 title 注入被转义', md.render('[a](https://a.com "x\\" onmouseover=\\"alert(1)")'), 'onmouseover=alert');

/* ---------------------------------------------------------------- 功能 */
console.log('\n[块级]');
eq('标题', md.render('# 标题'), '<h1>标题</h1>');
eq('二级标题', md.render('## 标题'), '<h2>标题</h2>');
eq('六号标题', md.render('###### 标题'), '<h6>标题</h6>');
eq('分隔线', md.render('---'), '<hr>');
eq('引用', md.render('> 引用内容'), '<blockquote><p>引用内容</p></blockquote>');
eq('围栏代码块', md.render('```js\nconst a = 1;\n```'), '<pre><code class="language-js">const a = 1;</code></pre>');
has('代码块内的标签被转义', md.render('```\n<b>x</b>\n```'), '&lt;b&gt;');
notHas('代码块内不解析 Markdown', md.render('```\n**粗**\n```'), '<strong>');

console.log('\n[段落与换行]');
eq('单段', md.render('普通文字'), '<p>普通文字</p>');
eq('空行分段', md.render('第一段\n\n第二段'), '<p>第一段</p>\n<p>第二段</p>');
eq('单换行转 br', md.render('第一行\n第二行'), '<p>第一行<br>\n第二行</p>');

console.log('\n[行内]');
eq('粗体', md.render('**粗体**'), '<p><strong>粗体</strong></p>');
eq('斜体', md.render('*斜体*'), '<p><em>斜体</em></p>');
eq('粗斜体', md.render('***both***'), '<p><strong><em>both</em></strong></p>');
eq('删除线', md.render('~~删除~~'), '<p><del>删除</del></p>');
eq('行内代码', md.render('`code`'), '<p><code>code</code></p>');
notHas('行内代码内不解析格式', md.render('`**x**`'), '<strong>');
eq('下划线粗体', md.render('__粗__'), '<p><strong>粗</strong></p>');
notHas('变量名式下划线不误判', md.render('a_b_c'), '<em>');

console.log('\n[链接与图片]');
eq('链接', md.render('[文字](https://a.com)'), '<p><a href="https://a.com" target="_blank" rel="noopener noreferrer">文字</a></p>');
eq('站内链接不加 target', md.render('[文字](/atelier)'), '<p><a href="/atelier">文字</a></p>');
has('图片', md.render('![替代](https://a.com/b.png)'), '<img src="https://a.com/b.png" alt="替代"');
has('裸链接自动识别', md.render('访问 https://a.com 看看'), '<a href="https://a.com"');
has('www 自动补协议', md.render('访问 www.a.com'), 'href="http://www.a.com"');

console.log('\n[列表]');
eq('无序列表', md.render('- a\n- b'), '<ul><li><p>a</p></li><li><p>b</p></li></ul>');
eq('有序列表', md.render('1. a\n2. b'), '<ol><li><p>a</p></li><li><p>b</p></li></ol>');
has('有序列表起始值', md.render('3. a'), '<ol start="3">');
has('嵌套列表', md.render('- a\n  - b'), '<ul>');
has('嵌套产生两层 ul', md.render('- a\n  - b'), '<li><p>a</p>');
has('任务式写法的方括号保留', md.render('- [ ] 待办'), '[ ] 待办');

console.log('\n[表格]');
const t = md.render('| A | B |\n| --- | ---: |\n| 1 | 2 |');
has('表格结构', t, '<table>');
has('表头', t, '<th>A</th>');
has('右对齐', t, 'text-align:right');
has('单元格', t, '<td>1</td>');

console.log('\n[组合]');
const combo = md.render('# 标题\n\n正文 **加粗**\n\n- 项目一\n- 项目二\n\n```\ncode\n```');
has('组合：标题', combo, '<h1>标题</h1>');
has('组合：加粗', combo, '<strong>加粗</strong>');
has('组合：列表', combo, '<ul>');
has('组合：代码块', combo, '<pre>');

console.log('\n[边界情况]');
eq('空字符串', md.render(''), '');
eq('null', md.render(null), '');
eq('undefined', md.render(undefined), '');
eq('只有空白', md.render('   \n  \n'), '');
has('未闭合代码块也能闭合', md.render('```\ncode'), '<pre>');
has('未闭合粗体不崩溃', md.render('**abc'), 'abc');
has('超长行不崩溃', md.render('a'.repeat(50000)), '<p>');
has('大量列表不崩溃', md.render(Array(500).fill('- x').join('\n')), '<ul>');

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
if (failures.length) {
  console.log('\n失败项：');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('');
process.exit(fail ? 1 : 0);
