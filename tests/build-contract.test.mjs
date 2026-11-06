// 构建层的合同级保证（与 lib-builder 的 template/model 测试分工不同，这里只钉 CONTRACT §3/§6 的硬性质）
import test from "node:test";
import assert from "node:assert/strict";
import { buildSite } from "../lib/build.mjs";

const site = {
  schema_version: 1,
  site_id: "a".repeat(32),
  name: "lotus 日志",
  slug: "lotus-muse-site",
  subtitle: "由 Muse 维护",
  sort_direction: "newest_first",
  next_sequence: 4,
  base_url: "https://lotus-muse-site.pages.dev",
};
const mk = (n) => ({
  schema_version: 1,
  id: String(n).padStart(32, "0"),
  sequence: n,
  date: `2026.11.${n}`,
  time_label: "",
  title: `第 ${n} 条`,
  body: `正文 ${n}。\n\n第二段 ${n}。`,
  images: [],
  tags: [],
  created_at: "2026-11-06T00:00:00.000Z",
  updated_at: "2026-11-06T00:00:00.000Z",
});
const entries = [mk(1), mk(2), mk(3)];
const pages = [
  { schema_version: 1, id: "c".repeat(32), slug: "welcome", title: "欢迎", body: "说明。", template: "article", nav: true, images: [] },
  { schema_version: 1, id: "d".repeat(32), slug: "notes", title: "记录", body: "更新。", template: "blank", nav: false, images: [] },
];

test("同输入两次构建结果字节相同（可复现是回滚与验收的前提）", () => {
  const a = buildSite({ site, entries, pages, mediaPaths: [] });
  const b = buildSite({ site, entries, pages, mediaPaths: [] });
  assert.deepEqual(Object.keys(a.files), Object.keys(b.files));
  for (const k of Object.keys(a.files)) assert.equal(a.files[k], b.files[k], `${k} 两次不一致`);
});

test("产物键一律带 site/ 前缀，且不泄漏内容源到产物目录", () => {
  const { files } = buildSite({ site, entries, pages, mediaPaths: [] });
  for (const k of Object.keys(files)) {
    assert.ok(k.startsWith("site/"), `${k} 前缀不对`);
    assert.ok(!k.includes(".."), `${k} 含越界`);
  }
  assert.ok(files["site/index.html"]);
  assert.ok(files["site/assets/site.css"]);
  for (const n of [1, 2, 3]) assert.ok(files[`site/entries/${String(n).padStart(4, "0")}.html`]);
  assert.ok(files["site/pages/welcome.html"] && files["site/pages/notes.html"]);
});

test("传入顺序不影响结果（顺序无关性）", () => {
  const a = buildSite({ site, entries, pages, mediaPaths: [] });
  const b = buildSite({
    site,
    entries: [...entries].reverse(),
    pages: [...pages].reverse(),
    mediaPaths: [],
  });
  assert.deepEqual(Object.keys(a.files).sort(), Object.keys(b.files).sort());
  for (const k of Object.keys(a.files)) assert.equal(a.files[k], b.files[k]);
});

test("排序方向由清单决定，序号本身不因此改变", () => {
  const newest = buildSite({ site, entries, pages, mediaPaths: [] });
  const oldest = buildSite({
    site: { ...site, sort_direction: "oldest_first" },
    entries,
    pages,
    mediaPaths: [],
  });
  const pos = (html, needle) => html.indexOf(needle);
  const idx = newest.files["site/index.html"];
  const odx = oldest.files["site/index.html"];
  assert.ok(pos(idx, "第 3 条") < pos(idx, "第 1 条"), "倒序应第 3 条在前");
  assert.ok(pos(odx, "第 1 条") < pos(odx, "第 3 条"), "正序应第 1 条在前");
  assert.ok(idx.includes("#0003") || idx.includes("0003"), "首页要出现稳定编号");
});

test("媒体按路径落进 assets/media，重复路径只留一份", () => {
  const media = [
    { path: "b.png", content: "BB" },
    { path: "a.png", content: "AA" },
    { path: "b.png", content: "BB" },
  ];
  const { files, counts } = buildSite({ site, entries, pages, mediaPaths: media });
  assert.equal(files["site/assets/media/a.png"], "AA");
  assert.equal(files["site/assets/media/b.png"], "BB");
  assert.equal(counts.media, 2, "重复路径不该重复计");
});

test("缺参数的输入要报清楚错误而不是静默产空站", () => {
  assert.throws(() => buildSite({ entries, pages }), TypeError);
  const empty = buildSite({ site, entries: [], pages: [], mediaPaths: [] });
  assert.ok(empty.files["site/index.html"].includes("lotus 日志"), "空站也要能出可看的首页");
  assert.equal(empty.counts.entries, 0);
});

test("坏序号的记录被忽略而不是让整站构建崩溃", () => {
  const bad = [mk(1), { id: "x", body: "没有序号" }, mk(3)];
  const { counts, files } = buildSite({ site, entries: bad, pages: [], mediaPaths: [] });
  assert.equal(counts.entries, 2);
  assert.ok(!("site/entries/undefined.html" in files));
});
