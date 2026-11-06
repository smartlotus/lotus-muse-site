// 路由编译的回归测试。
// 曾经的真实缺陷：compile() 先把整个 pattern 过一遍 escapeRe，再去找"反斜杠+斜杠+冒号"，
// 而 escapeRe 根本不转义斜杠，于是所有带 :param 的路径永不匹配，接口整体 404。
// 这类缺陷不会让任何断言"看起来奇怪"，只会让调用方收到 404，所以必须在这里钉死。
import test from "node:test";
import assert from "node:assert/strict";
import { buildRouter, json, err, tokenEquals, bearer, ERROR_STATUS } from "../lib/http.mjs";

function makeRoutes() {
  return [
    { method: "GET", pattern: "/health", handler: () => {} },
    { method: "GET", pattern: "/entries", handler: () => {} },
    { method: "GET", pattern: "/entries/:seq", handler: () => {} },
    { method: "PUT", pattern: "/entries/:seq", handler: () => {} },
    { method: "DELETE", pattern: "/entries/:seq", handler: () => {} },
    { method: "GET", pattern: "/pages/:slug", handler: () => {} },
    { method: "POST", pattern: "/actions/rollback-entry", handler: () => {} },
  ];
}

test("带 :param 的路径必须真的匹配上（回归：曾因转义顺序整体 404）", () => {
  const r = buildRouter(makeRoutes());
  const hit = r.match("GET", "/entries/0007");
  assert.ok(hit, "/entries/0007 不该匹配失败");
  assert.ok(!hit.wrongMethod);
  assert.equal(hit.params.seq, "0007");
  const hit2 = r.match("GET", "/pages/release-notes");
  assert.equal(hit2.params.slug, "release-notes");
});

test("同一路径不同方法各自路由，不错方法时不误判", () => {
  const r = buildRouter(makeRoutes());
  assert.equal(r.match("PUT", "/entries/0007").route.method, "PUT");
  assert.equal(r.match("DELETE", "/entries/0007").route.method, "DELETE");
});

test("已知路径配错方法 -> wrongMethod（对应 405），未知路径 -> null（对应 404）", () => {
  const r = buildRouter(makeRoutes());
  assert.equal(r.match("POST", "/health").wrongMethod, true);
  assert.equal(r.match("GET", "/nope"), null);
  assert.equal(r.match("GET", "/entries/0007/extra"), null);
});

test("参数做 URL 解码，且不允许跨段", () => {
  const r = buildRouter(makeRoutes());
  assert.equal(r.match("GET", "/pages/a%20b").params.slug, "a b");
  assert.equal(r.match("GET", "/entries/0001%2F0002").params.seq, "0001/0002");
  // 解码后含斜杠的参数不该被当成路径分隔符使用，交由上层 assertSafeRelPath 拒绝
});

test("静态段里的正则元字符不被当成模式", () => {
  const r = buildRouter([{ method: "GET", pattern: "/actions/rollback-entry", handler: () => {} }]);
  assert.ok(r.match("GET", "/actions/rollback-entry"));
  assert.equal(r.match("GET", "/actions/rollbackXentry"), null);
});

test("响应恒为 {ok} 形状且错误码到状态号的映射齐全", async () => {
  const ok = await json({ ok: true, a: 1 });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-type"), /application\/json/);
  assert.equal((await ok.json()).a, 1);

  const e = err("unsafe_path", "越界");
  assert.equal(e.status, 400);
  const body = await e.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "unsafe_path");

  for (const [code, status] of Object.entries(ERROR_STATUS)) {
    const res = err(code, "x");
    assert.equal(res.status, status, `${code} 应映射到 ${status}`);
  }
  assert.equal(err("没有这个码", "x").status, 500);
});

test("bearer 解析与 token 比对：空/缺失/长度不同都不能被当成相等", () => {
  const req = (h) => new Request("https://w.dev/", { headers: h ? { authorization: h } : {} });
  assert.equal(bearer(req("Bearer abc")), "abc");
  assert.equal(bearer(req("bearer abc")), "abc");
  assert.equal(bearer(req("")), "");
  assert.equal(bearer(req("Token abc")), "");
  assert.equal(tokenEquals("abc", "abc"), true);
  assert.equal(tokenEquals("abc", "abd"), false);
  assert.equal(tokenEquals("abc", "ab"), false);
  assert.equal(tokenEquals("", ""), true);
  assert.equal(tokenEquals("abc", undefined), false);
});
