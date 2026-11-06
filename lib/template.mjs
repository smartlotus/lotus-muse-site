// lib/template.mjs — HTML 渲染（CONTRACT §3）
//
// 纯字符串函数：不碰 fs、不取时钟、不读 env。所有用户文本一律转义之后才进 HTML。
// 版式沿用既有站点（LotusSiteManager/artifacts/template-preview.html）那一族：暖纸底
// #fdfcf7 / 页面底 #e9ece5、墨绿 ribbon #2f5143、陶土 kicker #c4654d、Noto Serif SC 正文、
// 900px shell、log-entry 卡片与 log-gallery 规则。
// 预览稿里的样例装饰（is-sample / sample-photo / "固定模板预览" 文案）不进真实产物。
//
// §3 的签名是解构对象；这里额外接受可选的 `pages` 键（renderIndex/renderEntry/renderPage），
// 用于在每一页渲染同一个导航条。不传等于空数组，向后兼容。

import { ModelError, MAX_EXCERPT } from "./model.mjs";

const PAGE_TEMPLATES = ["article", "blank", "gallery"];

/** 文本节点转义。 */
export function escapeHtml(s) {
  const str = s === null || s === undefined ? "" : String(s);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 属性值用同一套转义（双引号与单引号都已覆盖）。 */
const attr = escapeHtml;

/**
 * `\n\n` 分段；段内 `\n` -> `<br>`；先转义再拼标签。
 * @param {string} body
 * @returns {string} 若干 `<p>…</p>`，段之间用换行连接
 */
export function parasToHtml(body) {
  if (body === null || body === undefined || body === "") return "";
  const text = typeof body === "string" ? body : String(body);
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** `media/2026-11-06/a.png` -> `/assets/media/2026-11-06/a.png`（build.mjs 的落点）。 */
function mediaSrc(path) {
  const p = typeof path === "string" ? path : "";
  const rel = p.startsWith("media/") ? p.slice("media/".length) : p;
  return `/assets/media/${rel}`;
}

function excerptOf(body, max = MAX_EXCERPT) {
  const flat = (typeof body === "string" ? body : "").replace(/\s+/g, " ").trim();
  if (flat === "") return "";
  if (flat.length <= max) return escapeHtml(flat);
  return `${escapeHtml(flat.slice(0, max))}…`;
}

function safeSlug(value, field) {
  const s = typeof value === "string" ? value : "";
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(s)) {
    throw new ModelError(`${field} 不是安全的文件名（[a-z0-9-]，以字母或数字开头，≤60）：${s}`, field);
  }
  return s;
}

const pad4 = (n) => String(n).padStart(4, "0");
const entryHref = (sequence) => `/entries/${pad4(sequence)}.html`;
const pageHref = (slug) => `/pages/${slug}.html`;

/** 把多行块整体缩进 n 列（空行丢掉，保证产物里没有空行）。 */
function indent(block, spaces) {
  const pad = " ".repeat(spaces);
  return String(block)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => `${pad}${line}`)
    .join("\n");
}

const joinHtml = (lines) => lines.filter((l) => typeof l === "string" && l !== "").join("\n");

function galleryHtml(images) {
  if (!Array.isArray(images) || images.length === 0) return "";
  const single = images.length === 1 ? " is-single" : "";
  const figures = images.map((img) =>
    joinHtml([
      "<figure>",
      `<img src="${attr(mediaSrc(img && typeof img.path === "string" ? img.path : ""))}" alt="${attr(altOf(img))}" loading="lazy">`,
      `<figcaption>${escapeHtml(altOf(img))}</figcaption>`,
      "</figure>",
    ])
  );
  return joinHtml([`<div class="log-gallery${single}">`, ...figures.map((f) => indent(f, 2)), "</div>"]);
}

function altOf(img) {
  return img && typeof img.alt === "string" && img.alt !== "" ? img.alt : "日志图片";
}

const GALLERY_EMPTY = joinHtml([
  '<div class="log-gallery">',
  '<div class="empty-state">',
  '<span class="empty-mark">图</span>',
  "<h2>这一页还没有图</h2>",
  "<p>把图片放进 media/，再在 content/pages 的 images 里写上路径，这里就会出现图集。</p>",
  "</div>",
  "</div>",
]);

const INDEX_EMPTY = joinHtml([
  '<div class="empty-state">',
  '<span class="empty-mark">空</span>',
  "<h2>还没有一条记录</h2>",
  "<p>第一条记录写进 content/entries 之后，这里就会开始排队。</p>",
  "</div>",
]);

function tagsBlock(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  return joinHtml(['<ul class="tag-list">', ...tags.map((t) => `  <li>${escapeHtml(t)}</li>`), "</ul>"]);
}

function tagsInline(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  return `<span class="entry-tags">${tags.map((t) => escapeHtml(t)).join(" · ")}</span>`;
}

function metaRow(entry, { linked }) {
  const when = [entry.date, entry.time_label].filter((x) => typeof x === "string" && x !== "").join(" ");
  const seq = `#${pad4(entry.sequence)}`;
  const seqCell = linked
    ? `<a class="log-sequence" href="${attr(entryHref(entry.sequence))}">${escapeHtml(seq)}</a>`
    : `<span class="log-sequence">${escapeHtml(seq)}</span>`;
  return joinHtml([
    '<div class="log-meta">',
    `  <time class="log-date">${escapeHtml(when)}</time>`,
    `  ${seqCell}`,
    "</div>",
  ]);
}

function ribbonHtml(site) {
  const right = site.subtitle && site.subtitle !== "" ? site.subtitle : "个人记录";
  return `<aside class="site-ribbon"><strong>${escapeHtml(site.name)}</strong><span>${escapeHtml(right)}</span></aside>`;
}

function navHtml(pages) {
  const items = (Array.isArray(pages) ? pages : [])
    .filter((p) => p && p.nav === true)
    .map((p) => `<li><a href="${attr(pageHref(safeSlug(p.slug, "page.slug")))}">${escapeHtml(p.title || p.slug)}</a></li>`);
  return joinHtml([
    '<nav class="site-nav" aria-label="站点导航">',
    '  <a class="nav-home" href="/">首页</a>',
    items.length > 0 ? joinHtml(['  <ul class="nav-list">', ...items.map((li) => `  ${li}`), "  </ul>"]) : "",
    "</nav>",
  ]);
}

function siteHeaderHtml(site) {
  return joinHtml([
    '<header class="site-header">',
    `  <span class="site-kicker">${escapeHtml(site.slug || site.name)}</span>`,
    `  <h1 class="site-title"><a href="/">${escapeHtml(site.name)}</a></h1>`,
    site.subtitle ? `  <p class="site-subtitle">${escapeHtml(site.subtitle)}</p>` : "",
    "</header>",
  ]);
}

function pageTitleHtml(title, subtitle, kicker) {
  return joinHtml([
    '<header class="site-header">',
    `  <span class="site-kicker">${escapeHtml(kicker)}</span>`,
    `  <h1 class="site-title">${escapeHtml(title)}</h1>`,
    subtitle ? `  <p class="site-subtitle">${escapeHtml(subtitle)}</p>` : "",
    "</header>",
  ]);
}

/** 非 blank 版式的页面自己的标题区（h1 已经给了站名，这里用 h2）。 */
function pageHeadingHtml(title, subtitle) {
  return joinHtml([
    '<header class="page-header">',
    `  <h2 class="page-title">${escapeHtml(title)}</h2>`,
    subtitle ? `  <p class="page-subtitle">${escapeHtml(subtitle)}</p>` : "",
    "</header>",
  ]);
}

function footerHtml(site) {
  return joinHtml([
    '<footer class="footer">',
    `  <span>${escapeHtml(site.name)} · ${escapeHtml(site.slug)}</span>`,
    '  <span>内容以 JSON 存放在仓库里，构建为静态站点。<a href="/">返回索引</a></span>',
    "</footer>",
  ]);
}

const HEAD_OPEN = (titleText) =>
  joinHtml([
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <meta name="generator" content="lotus-muse-site">',
    `  <title>${escapeHtml(titleText)}</title>`,
    '  <link rel="stylesheet" href="/assets/site.css">',
    "</head>",
    "<body>",
  ]);

/**
 * 通用外壳（站点 ribbon + nav + header + 正文 + footer）。
 * @param {object} site
 * @param {string} titleText
 * @param {string[]} blocks 相对缩进为 0 的正文块
 * @param {{pages?:object[], shellClass?:string}} opts
 */
function wrap(site, titleText, blocks, opts = {}) {
  const inner = [
    ribbonHtml(site),
    navHtml(opts.pages ?? []),
    siteHeaderHtml(site),
    ...blocks,
    footerHtml(site),
  ];
  const shellClass = opts.shellClass ? ` ${opts.shellClass}` : "";
  return joinHtml([
    HEAD_OPEN(titleText),
    `  <main class="shell${shellClass}">`,
    ...inner.map((b) => indent(b, 4)),
    "  </main>",
    "</body>",
    "</html>",
    "",
  ]);
}

function requireObject(value, label, fn) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelError(`${fn} 需要 ${label}`, label);
  }
  return value;
}

function entryCard(entry) {
  const seq = pad4(entry.sequence);
  const href = entryHref(entry.sequence);
  const heading = entry.title && entry.title !== "" ? entry.title : `#${seq}`;
  const imageCount = Array.isArray(entry.images) ? entry.images.length : 0;
  const text = excerptOf(entry.body);
  const foot = joinHtml([
    '<div class="entry-foot">',
    `  <span class="media-badge">图片 ${imageCount}</span>`,
    tagsInline(entry.tags) ? `  ${tagsInline(entry.tags)}` : "",
    `  <a class="entry-read-more" href="${attr(href)}">阅读全文 →</a>`,
    "</div>",
  ]);
  return joinHtml([
    `<article class="entry-card" id="entry-${seq}">`,
    metaRow(entry, { linked: true }),
    `  <h2 class="entry-card-title"><a href="${attr(href)}">${escapeHtml(heading)}</a></h2>`,
    `  <p class="entry-excerpt">${text === "" ? "（这一条没有正文）" : text}</p>`,
    foot,
    "</article>",
  ]);
}

/**
 * 首页：站点清单 + 全部记录，按 site.sort_direction 排序。
 * @param {{site:object, entries:object[], pages?:object[]}} p
 */
export function renderIndex({ site, entries, pages = [] } = {}) {
  requireObject(site, "site", "renderIndex");
  const list = (Array.isArray(entries) ? entries : []).slice();
  list.sort((a, b) =>
    site.sort_direction === "oldest_first" ? a.sequence - b.sequence : b.sequence - a.sequence
  );

  const cards = list.map((entry) => indent(entryCard(entry), 2));
  const section = joinHtml([
    '<section class="entry-list" aria-label="日志记录">',
    ...(cards.length > 0 ? cards : [indent(INDEX_EMPTY, 2)]),
    "</section>",
  ]);

  const subtitle = site.subtitle ? ` · ${site.subtitle}` : "";
  return wrap(site, `${site.name}${subtitle}`, [section], { pages });
}

function entryNavHtml(prev, next) {
  const left = prev
    ? `<a class="entry-prev" href="${attr(entryHref(prev.sequence))}">← 上一条 #${pad4(prev.sequence)}</a>`
    : '<span class="entry-prev is-empty">已是第一条</span>';
  const right = next
    ? `<a class="entry-next" href="${attr(entryHref(next.sequence))}">下一条 #${pad4(next.sequence)} →</a>`
    : '<span class="entry-next is-empty">已是最后一条</span>';
  return joinHtml(['<nav class="entry-nav" aria-label="记录翻页">', `  ${left}`, `  ${right}`, "</nav>"]);
}

/** prev/next 要么没有，要么必须是带整数 sequence 的记录——否则产物里会出现 /entries/undefined.html。 */
function requireNeighbor(neighbor, field) {
  if (neighbor === null || neighbor === undefined) return null;
  if (typeof neighbor !== "object" || !Number.isInteger(neighbor.sequence)) {
    throw new ModelError(`${field} 必须是带整数 sequence 的记录`, field);
  }
  return neighbor;
}

/**
 * 单条记录页：#序号、日期、时段、标题、正文、图集（单图整宽）、prev/next。
 * @param {{site:object, entry:object, prev?:object|null, next?:object|null, pages?:object[]}} p
 */
export function renderEntry({ site, entry, prev = null, next = null, pages = [] } = {}) {
  requireObject(site, "site", "renderEntry");
  requireObject(entry, "entry", "renderEntry");

  const seq = pad4(entry.sequence);
  const before = requireNeighbor(prev, "prev");
  const after = requireNeighbor(next, "next");
  const heading = entry.title && entry.title !== "" ? entry.title : `#${seq}`;
  const contentLines = [
    `<h2 class="entry-title">${escapeHtml(heading)}</h2>`,
    parasToHtml(entry.body),
    tagsBlock(entry.tags),
    galleryHtml(entry.images),
  ].filter((b) => b !== "");

  const content = joinHtml([
    '<div class="log-content">',
    ...contentLines.map((b) => indent(b, 2)),
    "</div>",
  ]);
  const article = joinHtml([
    `<article class="log-entry" id="entry-${seq}">`,
    indent(metaRow(entry, { linked: false }), 2),
    indent(content, 2),
    indent(entryNavHtml(before, after), 2),
    "</article>",
  ]);
  const section = joinHtml([
    '<section class="entry-single" aria-label="记录正文">',
    indent(article, 2),
    "</section>",
  ]);

  return wrap(site, `${heading} · ${site.name}`, [section], { pages });
}

/**
 * 独立网页：template = article | blank | gallery。
 * blank 不渲染 ribbon / nav 外壳（仍是完整合法 HTML，head 里同样带 root-relative css）。
 * @param {{site:object, page:object, pages?:object[]}} p
 */
export function renderPage({ site, page, pages = [] } = {}) {
  requireObject(site, "site", "renderPage");
  requireObject(page, "page", "renderPage");

  const template = PAGE_TEMPLATES.includes(page.template) ? page.template : "article";
  const slug = safeSlug(page.slug, "page.slug");
  const title = page.title && page.title !== "" ? page.title : slug;
  const bodyBlock = parasToHtml(page.body);
  const gallery = galleryHtml(page.images);

  const blocks = [
    bodyBlock === ""
      ? ""
      : joinHtml(['<section class="page-body" aria-label="页面正文">', indent(bodyBlock, 2), "</section>"]),
    template === "gallery" ? (gallery === "" ? GALLERY_EMPTY : joinHtml([galleryLabel(slug), gallery])) : gallery,
  ].filter((b) => b !== "");

  if (template === "blank") {
    return joinHtml([
      HEAD_OPEN(title),
      `  <main class="shell is-blank page-${slug}">`,
      indent(pageTitleHtml(title, page.subtitle, "独立网页"), 4),
      ...blocks.map((b) => indent(b, 4)),
      indent(footerHtml(site), 4),
      "  </main>",
      "</body>",
      "</html>",
      "",
    ]);
  }

  const main = joinHtml([
    `<section class="page page-${template}" aria-label="独立网页">`,
    indent(pageHeadingHtml(title, page.subtitle), 2),
    ...blocks.map((b) => indent(b, 2)),
    "</section>",
  ]);
  return wrap(site, `${title} · ${site.name}`, [main], { pages, shellClass: `page-is-${template}` });
}

function galleryLabel(slug) {
  return `<p class="page-title-side" id="gallery-${slug}">图集</p>`;
}

/** 全站唯一样式表；与内容无关，因此是常量字符串（产物逐字确定）。 */
export function renderCss() {
  return CSS_TEXT;
}

const CSS_TEXT = `/* lotus-muse-site — 全站唯一样式表（构建产物，改样式请改 lib/template.mjs） */
:root {
  --color-bg: #e9ece5;
  --color-paper: #fdfcf7;
  --color-card: #fffefb;
  --color-ink: #25322c;
  --color-ink-strong: #21382e;
  --color-ink-body: #303b35;
  --color-muted: #647269;
  --color-ribbon: #2f5143;
  --color-ribbon-text: #fffdf6;
  --color-ribbon-soft: #dce8df;
  --color-accent: #c4654d;
  --color-line: #d9ddd5;
  --color-line-soft: #ccd2cc;
  --color-line-strong: #b8c2ba;
  --font-serif: "Noto Serif SC", "Songti SC", SimSun, Georgia, serif;
  --font-sans: "Microsoft YaHei UI", "PingFang SC", sans-serif;
  --font-mono: Consolas, "SFMono-Regular", monospace;
  --shell-width: 900px;
  --shell-padding: 48px;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--color-ink);
  background: var(--color-bg);
  font-family: var(--font-serif);
  line-height: 1.85;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--color-ribbon); text-decoration: none; }
a:hover { text-decoration: underline; }
.shell {
  width: var(--shell-width);
  max-width: calc(100% - 32px);
  min-height: 100vh;
  margin: 0 auto;
  padding: 0 var(--shell-padding) 72px;
  background: var(--color-paper);
  box-shadow: 0 16px 56px rgba(35, 48, 41, .13);
}
.site-ribbon {
  margin: 0 calc(var(--shell-padding) * -1);
  padding: 13px var(--shell-padding);
  color: var(--color-ribbon-text);
  background: var(--color-ribbon);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.6;
}
.site-ribbon strong { margin-right: 18px; }
.site-ribbon span { color: var(--color-ribbon-soft); }
.site-nav {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 20px;
  margin: 0 calc(var(--shell-padding) * -1);
  padding: 11px var(--shell-padding);
  background: rgba(253, 252, 247, .96);
  border-bottom: 1px solid var(--color-line-soft);
  border-top: 1px solid var(--color-line-soft);
  font-family: var(--font-sans);
  font-size: 13px;
}
.site-nav .nav-home { color: var(--color-ribbon); font-weight: 700; }
.nav-list { display: flex; flex-wrap: wrap; gap: 16px; margin: 0; padding: 0; list-style: none; }
.nav-list a { color: var(--color-muted); }
.nav-list a:hover { color: var(--color-ribbon); }
.site-header {
  position: relative;
  margin: 0 0 60px;
  padding: 40px 0 38px;
  border-bottom: 1px solid var(--color-line-strong);
  text-align: left;
}
.site-kicker {
  display: inline-block;
  margin-bottom: 18px;
  padding: 5px 10px;
  color: var(--color-paper);
  background: var(--color-accent);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .08em;
}
.site-title {
  max-width: 720px;
  margin: 0;
  color: var(--color-ink-strong);
  font-family: Georgia, var(--font-serif);
  font-size: 50px;
  line-height: 1.2;
  letter-spacing: -.02em;
}
.site-title a { color: inherit; text-decoration: none; }
.site-subtitle { max-width: 650px; margin: 16px 0 0; color: var(--color-muted); font-size: 16px; }
.entry-list { margin: 0; }
.log-entry, .entry-card {
  position: relative;
  margin: 0 0 64px;
  padding: 34px 38px 40px;
  background: var(--color-card);
  border: 1px solid var(--color-line);
  box-shadow: 0 12px 32px rgba(37, 50, 44, .08);
}
.entry-card { margin-bottom: 30px; padding: 26px 30px; }
.log-meta {
  display: table;
  width: 100%;
  margin-bottom: 28px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--color-line);
}
.log-date, .log-sequence { display: table-cell; vertical-align: middle; }
.log-date { color: var(--color-ink-strong); font-size: 18px; font-weight: 700; }
.log-sequence {
  width: 1%;
  padding: 5px 11px;
  color: #fffdf8;
  background: var(--color-ribbon);
  font-family: var(--font-mono);
  font-size: 13px;
  white-space: nowrap;
}
.entry-card .log-meta { margin-bottom: 18px; padding-bottom: 12px; }
.log-content { max-width: 680px; }
.log-content p {
  margin: 0 0 20px;
  color: var(--color-ink-body);
  font-size: 17px;
  text-align: justify;
  text-indent: 2em;
}
.entry-title { max-width: 680px; margin: 0 0 22px; color: var(--color-ink-strong); font-size: 24px; line-height: 1.45; }
.entry-card-title {
  max-width: 680px;
  margin: 0 0 10px;
  color: var(--color-ink-strong);
  font-family: Georgia, var(--font-serif);
  font-size: 22px;
  line-height: 1.4;
}
.entry-card-title a { color: inherit; }
.entry-excerpt { max-width: 680px; margin: 0; color: var(--color-ink-body); font-size: 15px; }
.entry-foot {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed var(--color-line);
  font-family: var(--font-sans);
  font-size: 12px;
}
.entry-tags { color: var(--color-muted); }
.media-badge {
  padding: 3px 9px;
  color: var(--color-ribbon);
  background: #eef2ea;
  border: 1px solid #cfd9cf;
  font-family: var(--font-mono);
  font-size: 12px;
}
.entry-read-more { margin-left: auto; color: var(--color-accent); font-weight: 700; }
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
  font-family: var(--font-sans);
  font-size: 12px;
}
.tag-list li { padding: 3px 10px; color: var(--color-muted); background: #f1f2ea; border: 1px solid var(--color-line); }
.log-gallery { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 32px; }
.log-gallery figure { flex: 1 1 280px; margin: 0; }
.log-gallery.is-single figure { flex-basis: 100%; }
.log-gallery img {
  display: block;
  width: 100%;
  height: auto;
  padding: 7px;
  background: #fff;
  border: 1px solid #cdd3cc;
}
.log-gallery figcaption {
  margin-top: 8px;
  color: var(--color-muted);
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 1.6;
}
.entry-nav {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 8px;
  padding-top: 22px;
  border-top: 1px solid var(--color-line-soft);
  font-family: var(--font-sans);
  font-size: 13px;
}
.entry-nav a { color: var(--color-ribbon); }
.entry-nav .entry-next { margin-left: auto; }
.entry-nav .is-empty { color: #9aa79e; }
.page-body { max-width: 700px; }
.page-body p {
  margin: 0 0 20px;
  color: var(--color-ink-body);
  font-size: 17px;
  text-align: justify;
  text-indent: 2em;
}
.page-header { max-width: 700px; margin: 0 0 30px; padding-bottom: 18px; border-bottom: 1px solid var(--color-line); }
.page-title { margin: 0; color: var(--color-ink-strong); font-family: Georgia, var(--font-serif); font-size: 30px; line-height: 1.3; }
.page-subtitle { margin: 12px 0 0; color: var(--color-muted); font-size: 15px; }
.page-title-side {
  max-width: 660px;
  margin: 0 0 6px;
  color: var(--color-ink-strong);
  font-size: 20px;
  font-weight: 700;
}
.shell.is-blank { box-shadow: none; }
.shell.is-blank .site-header { margin-bottom: 42px; padding-top: 48px; }
.empty-state {
  padding: 56px 24px;
  color: #5d6b63;
  background: #f4f3ec;
  border: 1px dashed #aeb9b0;
  text-align: center;
}
.empty-state .empty-mark { display: block; margin-bottom: 12px; color: var(--color-accent); font-size: 30px; }
.empty-state h2 { margin: 0 0 8px; color: #294236; font-size: 22px; }
.empty-state p { margin: 0; }
.footer {
  margin-top: 72px;
  padding-top: 26px;
  color: #758078;
  border-top: 1px solid var(--color-line-soft);
  text-align: center;
  font-family: var(--font-sans);
  font-size: 12px;
}
.footer span { display: block; }
.footer a { color: #758078; }
@media (max-width: 640px) {
  .shell { max-width: calc(100% - 16px); padding: 0 18px 48px; }
  .site-ribbon { margin-left: -18px; margin-right: -18px; padding: 12px 18px; }
  .site-ribbon strong, .site-ribbon span { display: block; margin: 0; }
  .site-nav { margin-left: -18px; margin-right: -18px; padding: 10px 18px; gap: 12px; }
  .site-header { margin-bottom: 38px; padding-top: 34px; }
  .site-title { font-size: 36px; }
  .log-entry { margin-bottom: 38px; padding: 24px 20px 28px; }
  .entry-card { margin-bottom: 22px; padding: 20px 18px; }
  .log-content p, .page-body p { font-size: 16px; text-align: left; }
  .log-gallery { display: block; }
  .log-gallery figure { margin-bottom: 14px; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
`;
