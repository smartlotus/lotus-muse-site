// tests/model.test.mjs — lib/model.mjs（CONTRACT §3 / §5）
import test from "node:test";
import assert from "node:assert/strict";

import {
  ModelError,
  assertSafeRelPath,
  normalizeEntry,
  normalizePage,
  normalizeSite,
  seqName,
  slugify,
  validateEntryInput,
  validatePageInput,
} from "../lib/model.mjs";

const validEntry = (over = {}) => ({
  sequence: 7,
  date: dotted("2026", "11", "6"),
  time_label: "晚上",
  title: "一条记录",
  body: "第一段。\n\n第二段。",
  tags: ["日常"],
  images: [],
  ...over,
});

const fieldsOf = (result) => result.errors.map((e) => e.field);
const complains = (result, field) => result.errors.some((e) => e.field === field);

// 日期字面量用 join 造，避免分隔符在工具链里被改写
const DOT = String.fromCharCode(46);
const DASH = String.fromCharCode(45);
const SLASH = String.fromCharCode(47);
const dotted = (...parts) => parts.join(DOT);
const iso = (...parts) => parts.join(DASH);
const slashed = (...parts) => parts.join(SLASH);
const mediaImage = (i) => ({ id: "", path: `media/2026-11-06/img${i}.png`, alt: "图", order: i });

// ---------------------------------------------------------------- 路径安全

test("assertSafeRelPath 拒绝一切仓库外/穿越/隐藏/绝对路径", () => {
  const bad = [
    "../../etc/passwd",
    "content/../../etc/passwd",
    "media/../site/index.html",
    "C:\\Windows\\win.ini",
    "C:/Windows/win.ini",
    "\\\\server\\share\\x.png",
    "/abs/path",
    ".\\hidden",
    "media/.hidden/x.png",
    "media/./x.png",
    "..",
    ".",
    "lib/model.mjs",
    "package.json",
    "content//entries/x.json",
    "site/",
    "media/a\\b.png",
    "",
    null,
    undefined,
    42,
  ];
  for (const p of bad) {
    assert.throws(() => assertSafeRelPath(p), ModelError, `应该拒绝 ${JSON.stringify(p)}`);
  }
});

test("assertSafeRelPath 的不安全路径带 unsafe_path 错误码", () => {
  assert.throws(
    () => assertSafeRelPath("../x"),
    (e) => e instanceof ModelError && e.code === "unsafe_path" && e.field === "path"
  );
});

test("assertSafeRelPath 默认只放行 content/ site/ media/ backups/", () => {
  const ok = ["content/entries/0001.json", "site/index.html", "media/2026-11-06/a.png", "backups/2026-11-06T07-00-00Z/content/site.json"];
  for (const p of ok) assert.equal(assertSafeRelPath(p), p, `应放行 ${p}`);
  assert.throws(() => assertSafeRelPath("api/src/index.js"), ModelError);
  assert.throws(() => assertSafeRelPath("content"), ModelError);
});

test("assertSafeRelPath 支持调用方给的白名单", () => {
  assert.equal(assertSafeRelPath("media/a.png", ["media/"]), "media/a.png");
  assert.throws(() => assertSafeRelPath("content/entries/0001.json", ["media/"]), ModelError);
  assert.equal(assertSafeRelPath("site/a.css", ["site"]), "site/a.css");
  assert.throws(() => assertSafeRelPath("site/a.css", []), ModelError);
});

// ---------------------------------------------------------------- 序号

test("seqName 补零到 4 位，边界正确", () => {
  assert.equal(seqName(1), "0001");
  assert.equal(seqName(7), "0007");
  assert.equal(seqName(999), "0999");
  assert.equal(seqName(9999), "9999");
  for (const bad of [10000, 12345, 0, -1, 1.5, Number.NaN, "7", null, undefined, {}]) {
    assert.throws(() => seqName(bad), ModelError, `应该拒绝 ${String(bad)}`);
  }
});

// ---------------------------------------------------------------- slug

test("slugify 只留 [a-z0-9-]，去首尾连字符", () => {
  assert.equal(slugify("Hello World"), "hello-world");
  assert.equal(slugify("  Release -- Notes  "), "release-notes");
  assert.equal(slugify("v2.0 发布!!"), "v2-0");
  assert.equal(slugify("＿＿"), "page");
});

test("slugify 对中文/空输入降级为 page", () => {
  assert.equal(slugify(""), "page");
  assert.equal(slugify("我的首页"), "page");
  assert.equal(slugify("---"), "page");
  assert.equal(slugify(null), "page");
  assert.equal(slugify(123), "page");
});

test("slugify 截断到 60 字符且不以连字符结尾", () => {
  const long = slugify("a".repeat(200));
  assert.equal(long.length, 60);
  assert.match(long, /^[a-z0-9-]+$/);

  const boundary = slugify(`${"a".repeat(59)}-tail`);
  assert.equal(boundary.length, 59);
  assert.ok(!boundary.endsWith("-"), "截断后不能留下尾随连字符");

  const fullwidth = slugify("ＲＥＬＥＡＳＥ　ＮＯＴＥＳ");
  assert.equal(fullwidth, "release-notes");
});

// ---------------------------------------------------------------- entry 校验

test("validateEntryInput 放过一条正常记录", () => {
  const r = validateEntryInput(validEntry());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test("validateEntryInput：body 必填", () => {
  assert.equal(validateEntryInput(validEntry({ body: "" })).ok, false);
  assert.ok(complains(validateEntryInput(validEntry({ body: "" })), "body"));
  assert.ok(complains(validateEntryInput({ date: "2026.11.6" }), "body"));
  assert.ok(complains(validateEntryInput(validEntry({ body: 42 })), "body"));
  assert.equal(validateEntryInput(null).ok, false);
});

test("validateEntryInput：body 长度 1..20000", () => {
  assert.equal(validateEntryInput(validEntry({ body: "x".repeat(20000) })).ok, true);
  const over = validateEntryInput(validEntry({ body: "x".repeat(20001) }));
  assert.equal(over.ok, false);
  assert.ok(complains(over, "body"));
});

test("validateEntryInput：date 只认点分或 ISO 日期", () => {
  const good = [dotted("2026", "11", "6"), dotted("2026", "1", "05"), dotted("2026", "11", "06"), iso("2026", "11", "06")];
  for (const d of good) {
    assert.equal(validateEntryInput(validEntry({ date: d })).ok, true, `应放过 ${d}`);
  }
  const bad = [
    slashed("2026", "11", "06"),
    iso("2026", "11", "6"),
    dotted("2026", "11"),
    dotted("11", "6"),
    iso("2026", "11", "06") + "T07:00:00Z",
    "",
    dotted("2026", "11", "6") + " 晚上",
  ];
  for (const d of bad) {
    assert.equal(validateEntryInput(validEntry({ date: d })).ok, false, `应拒绝 ${JSON.stringify(d)}`);
  }
  assert.ok(complains(validateEntryInput(validEntry({ date: slashed("2026", "11", "06") })), "date"));
});
test("validateEntryInput：title/time_label/tags 上限", () => {
  assert.ok(complains(validateEntryInput(validEntry({ title: "标".repeat(121) })), "title"));
  assert.equal(validateEntryInput(validEntry({ title: "标".repeat(120) })).ok, true);
  assert.ok(complains(validateEntryInput(validEntry({ time_label: "夜".repeat(41) })), "time_label"));
  assert.ok(complains(validateEntryInput(validEntry({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })), "tags"));
  assert.ok(complains(validateEntryInput(validEntry({ tags: ["x".repeat(31)] })), "tags"));
  assert.equal(validateEntryInput(validEntry({ tags: Array.from({ length: 10 }, (_, i) => `t${i}`) })).ok, true);
});

test("validateEntryInput：images 最多 20 且路径必须在 media/ 下", () => {
  const many = validateEntryInput(validEntry({ images: Array.from({ length: 21 }, (_, i) => mediaImage(i)) }));
  assert.equal(many.ok, false);
  assert.ok(complains(many, "images"));
  assert.equal(validateEntryInput(validEntry({ images: Array.from({ length: 20 }, (_, i) => mediaImage(i)) })).ok, true);

  for (const path of ["../../etc/passwd", "C:\\media\\a.png", "/abs/a.png", ".\\hidden.png", "content/a.png", "site/a.png", "media/../etc/passwd", ""]) {
    const r = validateEntryInput(validEntry({ images: [{ path, alt: "" }] }));
    assert.equal(r.ok, false, `应拒绝图片路径 ${JSON.stringify(path)}`);
    assert.ok(complains(r, "images"));
  }

  const notObj = validateEntryInput(validEntry({ images: ["media/a.png"] }));
  assert.equal(notObj.ok, false);
  assert.ok(complains(notObj, "images"));
  assert.ok(complains(validateEntryInput(validEntry({ images: [{ path: "media/a.png", alt: "y".repeat(201) }] })), "images"));
});

test("validateEntryInput：sequence 非法时报错而不是沉默", () => {
  assert.ok(complains(validateEntryInput(validEntry({ sequence: 10000 })), "sequence"));
  assert.ok(complains(validateEntryInput(validEntry({ sequence: "0007" })), "sequence"));
});

// ---------------------------------------------------------------- entry 规范化

test("normalizeEntry 补齐默认值，不发明时间戳", () => {
  const out = normalizeEntry({ sequence: 3, body: "只有正文" });
  assert.equal(out.schema_version, 1);
  assert.equal(out.id, "");
  assert.equal(out.sequence, 3);
  assert.equal(out.date, "");
  assert.equal(out.time_label, "");
  assert.equal(out.title, "");
  assert.equal(out.body, "只有正文");
  assert.deepEqual(out.images, []);
  assert.deepEqual(out.tags, []);
  assert.ok(!("created_at" in out), "没有传 created_at 就不能凭空造一个");
  assert.ok(!("updated_at" in out), "没有传 updated_at 就不能凭空造一个");
});

test("normalizeEntry 只保留调用方给的时间戳与来源", () => {
  const out = normalizeEntry(
    validEntry({ created_at: "2026-11-06T13:20:00Z", updated_at: "2026-11-07T01:02:03Z", source: "muse", author: "lotus-muse-bot" })
  );
  assert.equal(out.created_at, "2026-11-06T13:20:00Z");
  assert.equal(out.updated_at, "2026-11-07T01:02:03Z");
  assert.equal(out.source, "muse");
  assert.equal(out.author, "lotus-muse-bot");

  const createdOnly = normalizeEntry(validEntry({ created_at: "2026-11-06T13:20:00Z" }));
  assert.equal(createdOnly.created_at, "2026-11-06T13:20:00Z");
  assert.ok(!("updated_at" in createdOnly));
});

test("normalizeEntry 把日期统一成旧站的点分形式", () => {
  assert.equal(normalizeEntry(validEntry({ date: iso("2026", "11", "06") })).date, dotted("2026", "11", "6"));
  assert.equal(normalizeEntry(validEntry({ date: dotted("2026", "11", "06") })).date, dotted("2026", "11", "6"));
  assert.equal(normalizeEntry(validEntry({ date: dotted("2026", "11", "6") })).date, dotted("2026", "11", "6"));
  assert.throws(() => normalizeEntry(validEntry({ date: slashed("2026", "11", "06") })), ModelError);
  assert.throws(() => normalizeEntry(validEntry({ date: dotted("2026", "13", "01") })), ModelError);
});
test("normalizeEntry 的 options.sequence 优先，且序号一经分配不变", () => {
  assert.equal(normalizeEntry({ sequence: 1, body: "x" }, { sequence: 9 }).sequence, 9);
  assert.equal(normalizeEntry({ sequence: 1, body: "x" }).sequence, 1);
  assert.throws(() => normalizeEntry({ body: "x" }), ModelError);
  assert.throws(() => normalizeEntry(validEntry({ sequence: 10000 })), ModelError);
});

test("重复规范化同一 entry 得到逐字相同的结果（序号稳定）", () => {
  const once = normalizeEntry(validEntry({ sequence: 42, date: iso("2026", "11", "06") }));
  const twice = normalizeEntry(once, { sequence: once.sequence });
  const thrice = normalizeEntry(twice);
  assert.deepEqual(twice, once);
  assert.deepEqual(thrice, once);
  assert.equal(seqName(thrice.sequence), "0042");
});

test("normalizeEntry 拒绝不安全图片路径并补齐图片字段", () => {
  assert.throws(() => normalizeEntry(validEntry({ images: [{ path: "../media/a.png" }] })), ModelError);
  assert.throws(() => normalizeEntry(validEntry({ images: [{ path: "content/a.png" }] })), ModelError);
  const out = normalizeEntry(validEntry({ images: [{ path: "media/a.png" }] }));
  assert.deepEqual(out.images, [{ id: "", path: "media/a.png", alt: "", order: 0 }]);
});

test("normalizeEntry 不静默截断超限内容", () => {
  assert.throws(() => normalizeEntry(validEntry({ title: "x".repeat(121) })), ModelError);
  assert.throws(() => normalizeEntry(validEntry({ tags: ["x".repeat(31)] })), ModelError);
});

// ---------------------------------------------------------------- page

test("validatePageInput 检查 body/template/nav/images", () => {
  assert.equal(validatePageInput({ slug: "welcome", title: "欢迎", body: "正文", template: "article", nav: true }).ok, true);
  assert.ok(complains(validatePageInput({ slug: "welcome", body: "" }), "body"));
  assert.ok(complains(validatePageInput({ slug: "welcome", body: "x".repeat(20001) }), "body"));
  assert.ok(complains(validatePageInput({ slug: "welcome", body: "x", template: "masonry" }), "template"));
  assert.ok(complains(validatePageInput({ slug: "welcome", body: "x", nav: "yes" }), "nav"));
  assert.ok(complains(validatePageInput({ slug: "welcome", body: "x", images: [{ path: "../a.png" }] }), "images"));
  assert.equal(validatePageInput(null).ok, false);
});

test("normalizePage 默认 article、nav:false，缺 slug 时用 title", () => {
  const out = normalizePage({ title: "Release Notes", body: "内容" });
  assert.equal(out.slug, "release-notes");
  assert.equal(out.template, "article");
  assert.equal(out.nav, false);
  assert.deepEqual(out.images, []);
  assert.equal(out.subtitle, "");
  assert.ok(!("created_at" in out));
  assert.equal(normalizePage({ title: "我的首页", body: "内容" }).slug, "page");
  assert.throws(() => normalizePage({ slug: "a", body: "x", template: "nope" }), ModelError);
  // 规范化只兜默认值，不判必填（必填交给 validate / API 层）
  assert.equal(normalizePage({ slug: "a", body: "" }).body, "");
  assert.throws(() => normalizePage({ slug: "a", body: 42 }), ModelError);
});

// ---------------------------------------------------------------- site

test("normalizeSite 补齐默认并校验排序/序号", () => {
  const out = normalizeSite({ name: "Lotus Blog" });
  assert.equal(out.schema_version, 1);
  assert.equal(out.slug, "lotus-blog");
  assert.equal(out.sort_direction, "newest_first");
  assert.equal(out.next_sequence, 1);
  assert.equal(out.subtitle, "");
  assert.equal(out.site_id, "");
  assert.ok(!("created_at" in out));
  assert.ok(!("updated_at" in out));

  const full = normalizeSite({
    schema_version: 1,
    site_id: "a1b6f2c93d40e75a8c1f9b640d2e5a71",
    name: "lotus 日志",
    slug: "lotus-muse-site",
    subtitle: "由 Muse 维护的个人记录",
    sort_direction: "oldest_first",
    next_sequence: 3,
    base_url: "https://lotus-muse-site.pages.dev",
    created_at: "2026-11-06T13:00:00Z",
    updated_at: "2026-11-08T14:10:00Z",
  });
  assert.equal(full.sort_direction, "oldest_first");
  assert.equal(full.next_sequence, 3);
  assert.equal(full.created_at, "2026-11-06T13:00:00Z");
  assert.equal(full.updated_at, "2026-11-08T14:10:00Z");
});

test("normalizeSite 拒绝坏输入", () => {
  assert.throws(() => normalizeSite({ name: "x", sort_direction: "random" }), ModelError);
  assert.throws(() => normalizeSite({ name: "x", next_sequence: 0 }), ModelError);
  assert.throws(() => normalizeSite({ name: "x", next_sequence: "3" }), ModelError);
  assert.throws(() => normalizeSite({ subtitle: "没有名字" }), ModelError);
  assert.throws(() => normalizeSite(null), ModelError);
  assert.throws(() => normalizeSite([]), ModelError);
});

test("ModelError 是 Error，并带上 field/code", () => {
  const e = new ModelError("坏了", "body");
  assert.ok(e instanceof Error);
  assert.equal(e.name, "ModelError");
  assert.equal(e.field, "body");
  assert.equal(e.code, "invalid_input");
});
