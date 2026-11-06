// tests/template.test.mjs — lib/template.mjs（CONTRACT §3）
import test from "node:test";
import assert from "node:assert/strict";

import { escapeHtml, parasToHtml, renderCss, renderEntry, renderIndex, renderPage } from "../lib/template.mjs";
import { ModelError } from "../lib/model.mjs";

// 日期/路径字面量一律用 join 造，避免分隔符在工具链里被改写
const DOT = String.fromCharCode(46);
const DASH = String.fromCharCode(45);
const dotted = (...parts) => parts.join(DOT);
const isoDir = (...parts) => parts.join(DASH);

const SITE_DATE = dotted("2026", "11", "6");
const MEDIA_A = `media/${isoDir("2026", "11", "06")}/a.png`;
const MEDIA_B = `media/${isoDir("2026", "11", "06")}/b.png`;

const site = (over = {}) => ({
  schema_version: 1,
  site_id: "a1b6f2c93d40e75a8c1f9b640d2e5a71",
  name: "lotus 日志",
  slug: "lotus-muse-site",
  subtitle: "由 Muse 维护的个人记录",
  sort_direction: "newest_first",
  next_sequence: 3,
  base_url: "https://lotus-muse-site.pages.dev",
  ...over,
});

const entry = (over = {}) => ({
  schema_version: 1,
  id: "4f2a91c7d8e30b56a17f4c0d9be23615",
  sequence: 2,
  date: SITE_DATE,
  time_label: "晚上",
  title: "傍晚的记录",
  body: "第一段正文。\n\n第二段正文。",
  images: [],
  tags: [],
  ...over,
});

const page = (over = {}) => ({
  schema_version: 1,
  id: "c9045e12a7db8f36015ce4a9d7b2830f",
  slug: "welcome",
  title: "欢迎来到这个站点",
  subtitle: "一点使用说明",
  body: "第一段。\n\n第二段。",
  template: "article",
  images: [],
  nav: true,
  ...over,
});

/** 每个页面都必须成立的最低结构约束。 */
function assertPageShell(html, t) {
  assert.ok(html.startsWith("<!doctype html>"), `${t}: doctype 必须是第一行`);
  assert.match(html, /^<!doctype html>\n<html lang="zh-CN">/, `${t}: lang=zh-CN`);
  assert.ok(html.includes('<meta charset="utf-8">'), t);
  assert.ok(html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'), t);
  assert.ok(html.includes('<link rel="stylesheet" href="/assets/site.css">'), `${t}: css 必须根相对`);
  assert.ok(!html.includes('href="assets/site.css"'), `${t}: 不能出现相对 css 路径`);
  assert.ok(html.includes("<title>"), t);
  assert.ok(html.trimEnd().endsWith("</html>"), `${t}: 必须收在 </html>`);
}

// ---------------------------------------------------------------- css

test("renderCss 沿用既有站点的色板与 shell 规则", () => {
  const css = renderCss();
  for (const token of ["#2f5143", "#c4654d", "#fdfcf7", "#e9ece5", "#25322c", "Noto Serif SC", "900px", ".log-gallery.is-single"]) {
    assert.ok(css.includes(token), `样式里应有 ${token}`);
  }
  for (const added of [".site-nav", ".entry-card", ".media-badge", ".entry-nav", ".page-body", "is-blank"]) {
    assert.ok(css.includes(added), `新增区块应有 ${added}`);
  }
  assert.ok(css.endsWith("\n"));
});

test("renderCss 不含预览稿的样例装饰", () => {
  const css = renderCss();
  for (const mockupOnly of ["is-sample", "sample-photo", "固定模板预览", "样例"]) {
    assert.ok(!css.includes(mockupOnly), `产物样式不该有 ${mockupOnly}`);
  }
  assert.equal(renderCss(), css, "样式必须是常量");
});

// ---------------------------------------------------------------- 转义

test("escapeHtml 转义五种字符", () => {
  assert.equal(escapeHtml(`<script>alert("x & 'y'")</script>`), "&lt;script&gt;alert(&quot;x &amp; &#39;y&#39;&quot;)&lt;/script&gt;");
  assert.equal(escapeHtml(""), "");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("parasToHtml 按空行分段、段内换行转 <br>", () => {
  assert.equal(parasToHtml(""), "");
  assert.equal(parasToHtml("甲\n\n乙"), "<p>甲</p>\n<p>乙</p>");
  assert.equal(parasToHtml("第一行\n第二行"), "<p>第一行<br>第二行</p>");
  assert.equal(parasToHtml("  \n\n  保留  \n\n"), "<p>保留</p>");
  const escaped = parasToHtml("<b>粗</b>\n\n<script>bad()</script>");
  assert.ok(!escaped.includes("<b>"), "不能留下原始标签");
  assert.ok(!escaped.includes("<script"), "不能留下 script");
  assert.ok(escaped.includes("&lt;b&gt;"), escaped);
  assert.equal(escaped.split("<p>").length - 1, 2);
});

// ---------------------------------------------------------------- 首页

test("renderIndex 输出真实站点头脑并且不含样例内容", () => {
  const html = renderIndex({ site: site(), entries: [entry()], pages: [page()] });
  assertPageShell(html, "index");
  assert.ok(html.includes("<nav"), "必须有导航条");
  assert.ok(html.includes('<footer class="footer">'), "必须有页脚");
  assert.ok(html.includes('<h1 class="site-title"><a href="/">lotus 日志</a></h1>'), "站名必须链回 /");
  assert.ok(!html.includes("is-sample"));
  assert.ok(!html.includes("样例"));
  assert.ok(!html.includes("固定模板预览"));
  assert.ok(html.includes("/pages/welcome.html"), "nav:true 的页面要出现在导航里");
});

test("renderIndex 只把 nav:true 的页面放进导航", () => {
  const pages = [page(), page({ slug: "secret", title: "不显示的页面", nav: false })];
  const html = renderIndex({ site: site(), entries: [], pages });
  assert.ok(html.includes("/pages/welcome.html"));
  assert.ok(!html.includes("/pages/secret.html"), "nav:false 不该进导航");
});

test("renderIndex 每条记录链接到 /entries/<seq>.html 并显示日期/时段/标题/摘要/媒体数", () => {
  const html = renderIndex({
    site: site(),
    entries: [entry({ sequence: 7, time_label: "深夜", title: "深夜的一条", images: [{ path: MEDIA_A, alt: "图 A", order: 0 }, { path: MEDIA_B, alt: "", order: 1 }] })],
  });
  assert.ok(html.includes('href="/entries/0007.html"'), html.slice(0, 200));
  assert.ok(html.includes(`<time class="log-date">${SITE_DATE} 深夜</time>`));
  assert.ok(html.includes("#0007"), "序号要补零到四位");
  assert.ok(html.includes("深夜的一条"));
  assert.ok(html.includes("第一段正文。 第二段正文。"), "摘要应把段落拼起来");
  assert.ok(html.includes('<span class="media-badge">图片 2</span>'));
});

test("renderIndex 摘要截到 160 字符", () => {
  const head = "开".repeat(150);
  const tail = "尾".repeat(60);
  const html = renderIndex({ site: site(), entries: [entry({ body: `${head}${tail}` })] });
  assert.ok(html.includes(head), "前 150 字应在摘要里");
  assert.ok(!html.includes(tail), "超出 160 的部分不能出现");
  assert.ok(html.includes("…"), "截断要带省略号");

  const shortHtml = renderIndex({ site: site(), entries: [entry({ body: "只有一句" })] });
  assert.ok(shortHtml.includes("只有一句"));
  assert.ok(!shortHtml.includes('<p class="entry-excerpt">只有一句…'));
});

test("renderIndex 按 sort_direction 排序", () => {
  const entries = [entry({ sequence: 1 }), entry({ sequence: 2 }), entry({ sequence: 3 })];
  const newest = renderIndex({ site: site(), entries });
  assert.ok(newest.indexOf("entry-0003") < newest.indexOf("entry-0002"), "newest_first 要把 3 排在 2 前");
  assert.ok(newest.indexOf("entry-0002") < newest.indexOf("entry-0001"));

  const oldest = renderIndex({ site: site({ sort_direction: "oldest_first" }), entries });
  assert.ok(oldest.indexOf("entry-0001") < oldest.indexOf("entry-0002"), "oldest_first 要反过来");
  assert.ok(oldest.indexOf("entry-0002") < oldest.indexOf("entry-0003"));
});

test("renderIndex 没有记录时给空状态而不是空白页", () => {
  const html = renderIndex({ site: site(), entries: [] });
  assertPageShell(html, "empty index");
  assert.ok(html.includes('<div class="empty-state">'));
  assert.ok(html.includes("还没有一条记录"));
  assert.ok(!html.includes("样例"));
});

test("renderIndex 转义用户文本", () => {
  const html = renderIndex({
    site: site({ name: `<script>alert(1)</script>` }),
    entries: [entry({ title: `<script>alert("x")</script>`, body: `<img src=x onerror=alert(1)>\n\n第二段` })],
  });
  assert.ok(!html.includes("<script"), "标题里的 script 不能进产物");
  assert.ok(!html.includes("<img src=x"), "正文里的 img 不能进产物");
  assert.ok(html.includes("&lt;script&gt;"));
});

// ---------------------------------------------------------------- 记录页

test("renderEntry 显示序号/日期/时段/标题/正文/图集", () => {
  const html = renderEntry({ site: site(), entry: entry({ sequence: 12 }) });
  assertPageShell(html, "entry");
  assert.ok(html.includes('<article class="log-entry" id="entry-0012">'));
  assert.ok(html.includes("#0012"));
  assert.ok(html.includes(`${SITE_DATE} 晚上`));
  assert.ok(html.includes('<h2 class="entry-title">傍晚的记录</h2>'));
  assert.ok(html.includes("<p>第一段正文。</p>"));
  assert.ok(html.includes("<p>第二段正文。</p>"));
  assert.ok(!html.includes('<a class="log-sequence"'), "详情页的序号不是链接");
});

test("renderEntry 单图整宽、多图九宫格，路径落到 /assets/media/", () => {
  const single = renderEntry({ site: site(), entry: entry({ images: [{ path: MEDIA_A, alt: "一张图", order: 0 }] }) });
  assert.ok(single.includes('<div class="log-gallery is-single">'), "一张图要走 is-single");
  assert.ok(single.includes(`src="/assets/media/${isoDir("2026", "11", "06")}/a.png"`), single);
  assert.ok(single.includes('alt="一张图"'));

  const two = renderEntry({ site: site(), entry: entry({ images: [{ path: MEDIA_A, alt: "A", order: 0 }, { path: MEDIA_B, alt: "B", order: 1 }] }) });
  assert.ok(two.includes('<div class="log-gallery">'), "多张图不能带 is-single");
  assert.ok(!two.includes("is-single"));

  const none = renderEntry({ site: site(), entry: entry() });
  assert.ok(!none.includes("log-gallery"), "没图就不渲染图集");
});

test("renderEntry 的 prev/next 在列表两端降级", () => {
  const middle = renderEntry({ site: site(), entry: entry({ sequence: 5 }), prev: entry({ sequence: 4 }), next: entry({ sequence: 6 }) });
  assert.ok(middle.includes('href="/entries/0004.html"'));
  assert.ok(middle.includes('href="/entries/0006.html"'));
  assert.ok(!middle.includes("is-empty"));

  const first = renderEntry({ site: site(), entry: entry({ sequence: 1 }), prev: null, next: entry({ sequence: 2 }) });
  assert.ok(first.includes("已是第一条"), "第一条不该有往前翻的死链");
  assert.ok(first.includes('href="/entries/0002.html"'));
  assert.ok(!first.includes('href="/entries/0000.html"'));

  const last = renderEntry({ site: site(), entry: entry({ sequence: 9 }), prev: entry({ sequence: 8 }), next: null });
  assert.ok(last.includes("已是最后一条"));
  assert.ok(last.includes('href="/entries/0008.html"'));
  assert.ok(!last.includes('href="/entries/0010.html"'));

  const only = renderEntry({ site: site(), entry: entry({ sequence: 3 }) });
  assert.ok(only.includes("已是第一条") && only.includes("已是最后一条"));
  assert.ok(!only.includes("undefined"), "缺失的 prev/next 不能漏出 undefined");
});

test("renderEntry 转义标题与正文", () => {
  const html = renderEntry({
    site: site(),
    entry: entry({ title: `<script>alert(1)</script>`, body: "安全的一段\n\n<script>alert(2)</script>" }),
  });
  assert.ok(!html.includes("<script"), "产物里不能出现原始 script 标签");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;script&gt;alert(2)&lt;/script&gt;"));
});

// ---------------------------------------------------------------- 独立网页

test("renderPage article 版式带完整站点外壳", () => {
  const html = renderPage({ site: site(), page: page() });
  assertPageShell(html, "page/article");
  assert.ok(html.includes('<aside class="site-ribbon">'));
  assert.ok(html.includes('<nav class="site-nav"'));
  assert.ok(html.includes('<main class="shell page-is-article">'));
  assert.ok(html.includes('<section class="page page-article"'));
  assert.ok(html.includes("<p>第一段。</p>"));
});

test("renderPage blank 版式不带 ribbon/nav", () => {
  const html = renderPage({ site: site(), page: page({ slug: "plain", template: "blank", title: "一页干净的东西", subtitle: "" }) });
  assertPageShell(html, "page/blank");
  assert.ok(!html.includes("site-ribbon"), "blank 不能有 ribbon");
  assert.ok(!html.includes("site-nav"), "blank 不能有导航条");
  assert.ok(html.includes('<main class="shell is-blank page-plain">'));
  assert.ok(html.includes("<title>一页干净的东西</title>"), "blank 的 title 不带站点后缀");
  assert.ok(html.includes("<p>第一段。</p>"));
  assert.ok(html.trimEnd().endsWith("</html>"));
});

test("renderPage gallery 版式没图时给空状态", () => {
  const empty = renderPage({ site: site(), page: page({ template: "gallery" }) });
  assertPageShell(empty, "page/gallery-empty");
  assert.ok(empty.includes('<div class="empty-state">'));
  assert.ok(empty.includes("这一页还没有图"));

  const filled = renderPage({ site: site(), page: page({ template: "gallery", images: [{ path: MEDIA_A, alt: "照片", order: 0 }] }) });
  assert.ok(filled.includes('<div class="log-gallery is-single">'));
  assert.ok(filled.includes(`src="/assets/media/${isoDir("2026", "11", "06")}/a.png"`));
  assert.ok(!filled.includes("这一页还没有图"));
});

test("renderPage 拒绝不安全的 slug，未知版式降级为 article", () => {
  for (const bad of ["../../etc/passwd", "C:/Windows/x", ".hidden", "中文页", "A".repeat(80).toLowerCase()]) {
    assert.throws(() => renderPage({ site: site(), page: page({ slug: bad }) }), ModelError, `应拒绝 slug ${bad}`);
  }
  const fallback = renderPage({ site: site(), page: page({ template: "masonry" }) });
  assert.ok(fallback.includes('<main class="shell page-is-article">'));
  assert.ok(fallback.includes('<aside class="site-ribbon">'));
});

test("renderPage 转义标题、副标题与正文", () => {
  const html = renderPage({ site: site(), page: page({ title: `<script>alert(1)</script>`, subtitle: `<b>粗</b>`, body: "<i>斜</i>" }) });
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<b>粗</b>"));
  assert.ok(html.includes("&lt;b&gt;粗&lt;/b&gt;"));
  assert.ok(html.includes("<p>&lt;i&gt;斜&lt;/i&gt;</p>"));
});

test("渲染缺参数时抛错而不是产出 undefined 页面", () => {
  assert.throws(() => renderIndex({ entries: [] }), ModelError);
  assert.throws(() => renderEntry({ site: site() }), ModelError);
  assert.throws(() => renderPage({ site: site() }), ModelError);
  assert.throws(() => renderEntry({ site: site(), entry: entry(), prev: { sequence: undefined } }), ModelError);
});
