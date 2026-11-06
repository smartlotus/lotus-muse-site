// GitHub Contents API 客户端。这是唯一真正碰仓库的一层，而线上写路径要等你建好
// 细粒度 PAT 才能真跑，所以这里用注入的假 fetch 把行为钉死：
// sha 必须先读后写、冲突只重试一次、删除必须带 sha、错误里不许泄漏 token。
import test from "node:test";
import assert from "node:assert/strict";
import { GitHubClient, GitHubError, b64ToBytes, bytesToB64 } from "../api/src/gh.mjs";

function fakeGH(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const key = `${init.method || "GET"} ${new URL(url).pathname}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const handler = routes[key] ?? routes[`${init.method || "GET"} *`];
    if (!handler) return { status: 404, text: async () => JSON.stringify({ message: "Not Found" }) };
    const out = typeof handler === "function" ? handler(calls.at(-1)) : handler;
    return { status: out.status ?? 200, text: async () => JSON.stringify(out.body ?? out) };
  };
  return { fetchImpl, calls };
}

const cfg = { token: "ghp_fake", owner: "smartlotus", repo: "lotus-muse-site" };

test("getFile：404 视作不存在而不是异常", async () => {
  const { fetchImpl } = fakeGH({});
  const gh = new GitHubClient({ ...cfg, fetchImpl });
  const f = await gh.getFile("content/entries/0009.json");
  assert.deepEqual(f, { content: null, sha: null, json: null });
});

test("getFile：base64 解码成文本并保留 sha", async () => {
  const content = "正文\n换行";
  const { fetchImpl } = fakeGH({
    "GET /repos/smartlotus/lotus-muse-site/contents/content/site.json": {
      body: { content: bytesToB64(new TextEncoder().encode(content)), sha: "sha1" },
    },
  });
  const gh = new GitHubClient({ ...cfg, fetchImpl });
  const f = await gh.getFile("content/site.json");
  assert.equal(f.content, content);
  assert.equal(f.sha, "sha1");
  assert.deepEqual(await gh.getText("content/site.json"), content);
});

test("put 必须先读到 sha 再带上，避免盲目覆盖", async () => {
  const { fetchImpl, calls } = fakeGH({
    "GET /repos/smartlotus/lotus-muse-site/contents/content/entries/0001.json": {
      body: { content: bytesToB64(new TextEncoder().encode("旧")), sha: "OLD" },
    },
    "PUT /repos/smartlotus/lotus-muse-site/contents/content/entries/0001.json": {
      body: { commit: { sha: "C1", html_url: "https://github.com/c/1" }, content: { sha: "NEW" } },
    },
  });
  const gh = new GitHubClient({ ...cfg, fetchImpl });
  const r = await gh.put({ path: "content/entries/0001.json", content: "新", message: "m" });
  assert.equal(r.sha, "C1");
  const put = calls.find((c) => c.key.startsWith("PUT"));
  assert.equal(put.body.sha, "OLD", "覆盖已有文件必须带当前 sha");
  assert.equal(put.body.branch, "main");
});

test("新建文件不带 sha", async () => {
  const { fetchImpl, calls } = fakeGH({
    "PUT /repos/smartlotus/lotus-muse-site/contents/content/entries/0003.json": {
      body: { commit: { sha: "C2", html_url: "u" }, content: { sha: "N" } },
    },
  });
  const gh = new GitHubClient({ ...cfg, fetchImpl });
  await gh.put({ path: "content/entries/0003.json", content: "x", message: "m" });
  const put = calls.find((c) => c.key.startsWith("PUT"));
  assert.ok(!("sha" in put.body), "新文件不该带 sha");
});

test("删除必须带 sha，缺失即报错而不是误删", async () => {
  const gh = new GitHubClient({ ...cfg, fetchImpl: fakeGH({}).fetchImpl });
  await assert.rejects(() => gh.remove({ path: "a.json", message: "m" }), /sha/);
});

test("commit 逐文件提交（多文件 contents 端点已废弃），并汇总改动清单", async () => {
  const { fetchImpl, calls } = fakeGH({
    "GET *": { body: { content: "", sha: "S" } },
    "PUT *": { body: { commit: { sha: "LAST", html_url: "https://x/last" }, content: { sha: "F" } } },
  });
  const gh = new GitHubClient({ ...cfg, fetchImpl });
  const r = await gh.commit({
    files: [
      { path: "content/b.json", content: "1" },
      { path: "content/a.json", content: "2" },
      { path: "site/index.html", content: "3" },
    ],
    message: "m",
    author: { name: "lotus-muse-bot", email: "bot@x" },
  });
  const puts = calls.filter((c) => c.key.startsWith("PUT"));
  assert.equal(puts.length, 3, "每个文件各一次提交");
  assert.equal(r.sha, "LAST");
  assert.deepEqual(r.changed_files, ["content/a.json", "content/b.json", "site/index.html"]);
  assert.equal(puts[0].body.author.name, "lotus-muse-bot");
});

test("409 冲突：重读 sha 后只重试一次；再冲突就抛错而不是无限重试", async () => {
  let putCount = 0;
  const { fetchImpl, calls } = fakeGH({
    "GET *": { body: { content: "", sha: "S" } },
    "PUT *": () => {
      putCount += 1;
      return putCount === 1
        ? { status: 409, body: { message: "A git repository was not found" } }
        : { body: { commit: { sha: "OK" }, content: { sha: "F" } } };
    },
  });
  const gh = new GitHubClient({ ...cfg, fetchImpl });
  const r = await gh.commit({ files: [{ path: "a.json", content: "x" }], message: "m" });
  assert.equal(r.sha, "OK");
  assert.equal(putCount, 2);

  putCount = 0;
  const always = fakeGH({
    "GET *": { body: { content: "", sha: "S" } },
    "PUT *": () => { putCount += 1; return { status: 409, body: { message: "conflict" } }; },
  });
  const gh2 = new GitHubClient({ ...cfg, fetchImpl: always.fetchImpl });
  await assert.rejects(
    () => gh2.commit({ files: [{ path: "a.json", content: "x" }], message: "m" }),
    GitHubError,
  );
  assert.equal(putCount, 2, "最多重试一次");
});

test("错误信息里不出现 token，且超长响应被截断", async () => {
  const leaky = "x".repeat(5000);
  const { fetchImpl } = fakeGH({
    "GET *": { status: 401, body: { message: `Bad credentials ${leaky}` } },
  });
  const gh = new GitHubClient({ ...cfg, fetchImpl });
  const e = await gh.commit({ files: [{ path: "a", content: "1" }], message: "m" }).catch((x) => x);
  assert.ok(e instanceof GitHubError);
  assert.ok(!e.message.includes("ghp_fake"), `错误里不该出现 token：${e.message.slice(0, 120)}`);
  assert.ok(e.message.length < 600, "错误信息要被截断");
});

test("listDir 只返回文件，404 视作空目录", async () => {
  const { fetchImpl } = fakeGH({
    "GET /repos/smartlotus/lotus-muse-site/contents/content/entries": {
      body: [
        { name: "0001.json", path: "content/entries/0001.json", sha: "1", type: "file" },
        { name: "sub", path: "content/entries/sub", sha: "2", type: "dir" },
      ],
    },
  });
  const gh = new GitHubClient({ ...cfg, fetchImpl });
  const items = await gh.listDir("content/entries");
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "0001.json");
  assert.deepEqual(await gh.listDir("content/pages"), []);
});

test("构造时缺 token / owner / repo 立刻失败，而不是等到第一次写", () => {
  assert.throws(() => new GitHubClient({ owner: "o", repo: "r" }), /token/);
  assert.throws(() => new GitHubClient({ token: "t", owner: "o" }), /owner|repo/);
});

test("b64 往返对中文与换行无损", () => {
  const s = "中文\nwith  spaces  和 emoji 🐌";
  const enc = bytesToB64(new TextEncoder().encode(s));
  assert.equal(new TextDecoder().decode(b64ToBytes(enc)), s);
});
