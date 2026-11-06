// Cloudflare Pages 直传（Workers 运行时：只用 fetch / crypto.subtle / FormData / Blob）
//
// 为什么用直传而不是 Git 绑定：本仓库不依赖 Cloudflare 的 GitHub App 是否被授权到
// 这个新仓库上，并且部署完成即刻拿到 URL，能拿真实线上字节做验收。
// 与本机既有工具同一形态：LotusSiteManager/src/LotusSiteManager.Core/CloudflareService.cs:77
// 用的就是 `wrangler pages deploy`。
//
// 端点：POST /accounts/{account}/pages/projects/{project}/deployments
//   multipart: manifest = JSON { "<路径>": { "file": "<sha1 hex>" } }
//              files     = 每个 sha1 hex 一个字段（内容寻址，同名只传一次）
// 未在 manifest 里的路径必须作为 `files` 字段名直接给出；这里全部走 manifest，
// 因此每个上传字段的键恒为 "files"，值名恒为 sha1。

const HASH = "SHA-1";

function fail(message) {
  const e = new Error(message);
  e.name = "PagesError";
  throw e;
}

export async function sha1Hex(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes));
  const digest = await crypto.subtle.digest(HASH, buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// files: { "site/index.html": "<html>..." } -> Pages 需要去掉前缀目录后的相对路径
export function toSiteRel(path, prefix = "site/") {
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

export class PagesClient {
  constructor({
    token,
    accountId,
    project,
    branch = "main",
    commitDraft = false,
    fetchImpl = globalThis.fetch,
  }) {
    if (!token) fail("Pages token 未配置");
    if (!accountId) fail("Cloudflare Account ID 未配置");
    if (!project) fail("Pages 项目名未配置");
    this.token = token;
    this.accountId = accountId;
    this.project = project;
    this.branch = branch;
    this.commitDraft = commitDraft;
    this.fetch = fetchImpl;
  }

  // 上传并返回 { url, deployment_id, environment, sha1_count }
  async deploy(files, { commitMessage = "", parentNode = null } = {}) {
    const manifest = {};
    const unique = new Map();
    let totalBytes = 0;

    for (const [repoPath, content] of Object.entries(files)) {
      const rel = toSiteRel(repoPath);
      if (rel === null) fail(`越界产物路径：${repoPath}`);
      if (rel === "" || rel.startsWith("/")) fail(`非法产物路径：${repoPath}`);
      const bytes =
        typeof content === "string" ? new TextEncoder().encode(content) : content;
      totalBytes += bytes.byteLength;
      const hash = await sha1Hex(bytes);
      manifest[`/${rel}`] = { file: hash };
      if (!unique.has(hash)) unique.set(hash, bytes);
    }

    if (Object.keys(manifest).length === 0) fail("没有可部署的产物文件");

    const form = new FormData();
    form.append(
      "manifest",
      new Blob([JSON.stringify(manifest)], { type: "application/json" }),
      "manifest",
    );
    for (const [hash, bytes] of unique) {
      form.append("files", new Blob([bytes]), hash);
    }

    const url =
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}` +
      `/pages/projects/${this.project}/deployments`;
    const res = await this.fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (!body || body.success !== true) {
      const msg = body && body.errors ? JSON.stringify(body.errors) : "未知错误";
      fail(`Pages 部署失败 HTTP ${res.status}: ${msg}`);
    }
    const r = body.result || {};
    return {
      url: r.url ? `https://${r.url}` : "",
      https_alias: r_httpsAlias(r),
      deployment_id: r.id || null,
      project_name: r.project_name || this.project,
      environment: r.environment || (this.commitDraft ? "preview" : "production"),
      created_time: r.created_time || null,
      uploads: unique.size,
      bytes: totalBytes,
    };
  }

  // 部署是异步的：轮询到 "success"，并取 phases 里的校验/上传结果。
  async waitUntilReady(deploymentId, { attempts = 30, delayMs = 2000 } = {}) {
    const base =
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}` +
      `/pages/projects/${this.project}/deployments/${deploymentId}`;
    let last = null;
    for (let i = 0; i < attempts; i += 1) {
      const res = await this.fetch(base, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const body = await res.json().catch(() => ({}));
      last = (body && body.result) || null;
      if (last && (last.deployment_stage === "success" || last.health_check === "failing")) {
        return last;
      }
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
    return last;
  }

  // 供 /status 用：最近一次部署的状态与 URL
  async latest() {
    const res = await this.fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}` +
        `/pages/projects/${this.project}/deployments?per_page=1`,
      { headers: { Authorization: `Bearer ${this.token}` } },
    );
    const body = await res.json().catch(() => ({}));
    const arr = (body && body.result) || [];
    return arr[0] || null;
  }
}

function r_httpsAlias(r) {
  return r && r.https_alias ? `https://${r.https_alias}` : "";
}
