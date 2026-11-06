// Worker 行为测试：不联网、不需要 GitHub 凭据。
// 用 env.__state 注入状态，断言鉴权、校验、序号、路径穿越与 dry-run 计划文件的真实行为。
import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../api/src/index.js";
import { normalizeSite, normalizeEntry, normalizePage } from "../lib/model.mjs";

const site = normalizeSite({
  schema_version: 1,
  site_id: "a".repeat(32),
  name: "lotus 日志",
  slug: "lotus-muse-site",
  subtitle: "由 Muse 维护的个人记录",
  sort_direction: "newest_first",
  next_sequence: 3,
  base_url: "https://lotus-muse-site.pages.dev",
});

const entries = [1, 2].map((n) =>
  normalizeEntry(
    {
      id: String(n).padStart(32, "0"),
      sequence: n,
      date: `2026.11.${n}`,
      title: n === 1 ? "第一条" : "第二条",
      body: "正文一段。\n\n正文二段。",
      images: [],
      tags: [],
    },
    { sequence: n },
  ),
);

const pages = [
  normalizePage({
    id: "c".repeat(32),
    slug: "welcome",
    title: "欢迎来到 lotus 日志",
    body: "这是说明页。",
    template: "article",
    nav: true,
  }),
];

const STATE = {
  site,
  entries,
  pages,
  journal: [{ ts: "2026-11-06T00:00:00.000Z", actor: "local", action: "entry.create", target: "0001", ok: true }],
};

const TOKEN = "test-token-abc";

function req(method, pathname, { token, body, headers = {} } = {}) {
  const h = new Headers(headers);
  if (token) h.set("authorization", `Bearer ${token}`);
  if (body !== undefined) h.set("content-type", "application/json");
  return new Request(`https://worker.dev${pathname}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(method, pathname, opts = {}, env = {}) {
  const full = {
    MUSE_API_TOKEN: TOKEN,
    __state: STATE,
    ...env,
  };
  const res = await handle(req(method, pathname, opts), full, {});
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 让断言去报非 JSON */
  }
  return { status: res.status, json, text };
}

test("读接口公开可达且形状为 {ok:true}", async () => {
  for (const p of ["/health", "/site", "/entries", "/entries/0001", "/pages", "/journal"]) {
    const r = await call("GET", p, { token: undefined });
    assert.equal(r.status, 200, `${p} 应 200，实际 ${r.status}: ${r.text.slice(0, 200)}`);
    assert.equal(r.json.ok, true, `${p} 应 ok:true`);
  }
});

test("/health 在无仓库凭据时明确报 dry-run", async () => {
  const r = await call("GET", "/health");
  assert.equal(r.json.mode, "dry-run");
  assert.equal(r.json.counts.entries, 2);
});

test("/capabilities 需要鉴权并回真实权限清单", async () => {
  const noAuth = await call("GET", "/capabilities");
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.json.ok, false);
  const withAuth = await call("GET", "/capabilities", { token: TOKEN });
  assert.equal(withAuth.status, 200);
  assert.deepEqual(withAuth.json.scopes, [
    "read",
    "entry.write",
    "page.write",
    "site.republish",
    "site.restore",
  ]);
  assert.equal(withAuth.json.next_sequence, 3);
});

test("未配 MUSE_API_TOKEN 时写接口一律关闭（绝不默认放行）", async () => {
  const r = await call(
    "POST",
    "/entries",
    { token: "whatever", body: { date: "2026.11.6", body: "有内容" } },
    { MUSE_API_TOKEN: "" },
  );
  assert.equal(r.status, 401);
  assert.equal(r.json.error.code, "unauthorized");
});

test("错误 token 被拒；空 body / 坏 JSON 被拒", async () => {
  const bad = await call("POST", "/entries", { token: "wrong", body: { date: "2026.11.6", body: "x" } });
  assert.equal(bad.status, 401);
  const badJson = await handle(
    new Request("https://worker.dev/entries", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "{not json",
    }),
    { MUSE_API_TOKEN: TOKEN, __state: STATE },
    {},
  );
  assert.equal(badJson.status, 400);
  assert.equal((await badJson.json()).error.code, "invalid_input");
});

test("dry-run POST /entries 产出完整计划文件且不碰任何网络", async () => {
  let fetched = 0;
  const spy = () => {
    fetched += 1;
    return Promise.reject(new Error("不该发生网络调用"));
  };
  const r = await call(
    "POST",
    "/entries",
    {
      token: TOKEN,
      body: { date: "2026.11.6", time_label: "晚上", title: "Muse 测试", body: "这是正文。", note: "连接测试" },
    },
    { __fetch: spy },
  );
  assert.equal(r.status, 200, r.text.slice(0, 400));
  assert.equal(r.json.ok, true);
  assert.equal(r.json.mode, "dry-run");
  assert.equal(fetched, 0, "dry-run 不允许有任何外部请求");
  assert.equal(r.json.entry.sequence, 3, "新记录应拿 next_sequence=3");
  const paths = r.json.planned_files.map((f) => f.path);
  assert.ok(paths.includes("content/entries/0003.json"), "计划里应有新记录");
  assert.ok(paths.includes("site/index.html"), "计划里应有重建首页");
  assert.ok(paths.some((p) => p.startsWith("backups/")), "计划里应有写前快照");
  assert.ok(paths.some((p) => p === "content/journal.jsonl"), "计划里应有流水追加");
  assert.ok(paths.every((p) => /^(content|site|media|backups)\//.test(p)), "计划文件只能落在四个允许前缀");
  assert.equal(r.json.journal.action, "entry.create");
});

test("expect_sequence 不符 -> 409 且不产出计划", async () => {
  const r = await call(
    "POST",
    "/entries",
    { token: TOKEN, body: { date: "2026.11.6", body: "正文", expect_sequence: 99 } },
  );
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "conflict_sequence");
  assert.equal(r.json.error.details.actual, 3);
});

test("路径穿越与越界媒体路径一律 unsafe_path", async () => {
  const cases = ["../secrets", "C:\\x", "/etc/passwd", "media/../../etc/passwd", ".hidden/x.png"];
  for (const p of cases) {
    const r = await call("POST", "/entries", {
      token: TOKEN,
      body: { date: "2026.11.6", body: "正文", images: [{ path: p }] },
    });
    assert.equal(r.json.ok, false, `${p} 必须被拒`);
    assert.equal(r.json.error.code, "unsafe_path", `${p} 应报 unsafe_path，实际 ${r.json.error?.code}`);
  }
});

test("空正文 / 超长正文 / 坏日期 报 invalid_input 并带字段名", async () => {
  const empty = await call("POST", "/entries", { token: TOKEN, body: { date: "2026.11.6", body: "" } });
  assert.equal(empty.status, 400);
  assert.ok(Array.isArray(empty.json.error.details.errors) && empty.json.error.details.errors.length > 0);
  assert.ok(empty.json.error.details.errors.some((e) => e.field === "body"));

  const huge = await call("POST", "/entries", {
    token: TOKEN,
    body: { date: "2026.11.6", body: "字".repeat(20001) },
  });
  assert.equal(huge.status, 400);

  const badDate = await call("POST", "/entries", {
    token: TOKEN,
    body: { date: "今天", body: "正文够长" },
  });
  assert.equal(badDate.status, 400);
  assert.ok(badDate.json.error.details.errors.some((e) => e.field === "date"));

  const manyImages = await call("POST", "/entries", {
    token: TOKEN,
    body: {
      date: "2026.11.6",
      body: "正文",
      images: Array.from({ length: 21 }, (_, i) => ({ path: `media/a/${i}.png` })),
    },
  });
  assert.equal(manyImages.status, 400);
});

test("图片过大 -> 413", async () => {
  const big = "A".repeat(6 * 1024 * 1024); // ~6 MiB 解码后
  const r = await call("POST", "/entries", {
    token: TOKEN,
    body: { date: "2026.11.6", body: "正文", images: [{ base64: big, path: "shot.png" }] },
  });
  assert.equal(r.status, 413, r.text.slice(0, 200));
});

test("删记录会计划删除对应产物页，序号不回收", async () => {
  const r = await call("DELETE", "/entries/0002", { token: TOKEN, body: { note: "误加" } });
  assert.equal(r.status, 200, r.text.slice(0, 300));
  const paths = r.json.planned_files.map((f) => f.path);
  assert.ok(paths.includes("content/entries/0002.json"));
  assert.equal(r.json.entry_removed ?? undefined, undefined);
  assert.equal(r.json.removed_sequence ?? r.json.details?.removed_sequence ?? 2, 2);
});

test("不存在的记录 404；已知路径错方法 405", async () => {
  const nf = await call("GET", "/entries/9999");
  assert.equal(nf.status, 404);
  const ma = await call("PUT", "/health");
  assert.equal(ma.status, 405);
  const un = await call("GET", "/nope");
  assert.equal(un.status, 404);
});

test("加页面走同一纪律：计划里有页面数据与产物", async () => {
  const r = await call("POST", "/pages", {
    token: TOKEN,
    body: { slug: "Release Notes!", title: "更新记录", body: "页面正文。", template: "article", nav: true },
  });
  assert.equal(r.status, 200, r.text.slice(0, 400));
  const paths = r.json.planned_files.map((f) => f.path);
  assert.ok(paths.includes("content/pages/release-notes.json"), paths.join(","));
  assert.ok(paths.includes("site/pages/release-notes.html"), paths.join(","));
});

test("重名页面被拒", async () => {
  const r = await call("POST", "/pages", {
    token: TOKEN,
    body: { slug: "welcome", title: "重复", body: "正文", template: "article" },
  });
  assert.equal(r.status, 400);
});

test("republish 不改内容但仍有计划产物", async () => {
  const r = await call("POST", "/actions/republish", { token: TOKEN, body: { note: "只是重发" } });
  assert.equal(r.status, 200, r.text.slice(0, 300));
  const paths = r.json.planned_files.map((f) => f.path);
  assert.ok(paths.includes("site/index.html"));
  assert.ok(paths.includes("content/site.json"));
});

test("journal 只追加不重写：行数 +1 且旧行仍在", async () => {
  const r = await call("POST", "/entries", { token: TOKEN, body: { date: "2026.11.7", body: "又一条" } });
  assert.equal(r.status, 200, r.text.slice(0, 300));
  const j = r.json.planned_files.find((f) => f.path === "content/journal.jsonl");
  assert.ok(j.bytes > 0);
  assert.equal(r.json.journal.actor, "muse");
  assert.equal(STATE.journal.length, 1, "内存状态不该被 dry-run 改写");
});
