// GitHub Contents API 客户端（Workers / Node 通用，fetch 可注入以便测试）
// 只用 Contents API，绝不 force push、绝不改历史。

export class GitHubError extends Error {
  constructor(status, body, path) {
    const detail = body && body.message ? ` — ${redact(body.message)}` : "";
    super(`GitHub HTTP ${status} @ ${path}${detail}`);
    this.name = "GitHubError";
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

const DEFAULT_API = "https://api.github.com";

function b64ToBytes(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes));
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function utf8Decode(bytes) {
  return new TextDecoder().decode(bytes);
}

function redact(text) {
  return String(text ?? "").replace(/gh[pousr]_[A-Za-z0-9_]+/g, "<redacted>").slice(0, 400);
}

export class GitHubClient {
  constructor({
    token,
    owner,
    repo,
    branch = "main",
    fetchImpl = globalThis.fetch,
    apiBase = DEFAULT_API,
  }) {
    if (!token) throw new Error("GitHubClient 需要 token");
    if (!owner || !repo) throw new Error("GitHubClient 需要 owner 与 repo");
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.fetch = fetchImpl;
    this.apiBase = apiBase;
  }

  base() {
    return `/repos/${this.owner}/${this.repo}`;
  }

  headers() {
    return {
      authorization: `Bearer ${this.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "lotus-muse-api",
    };
  }

  async call(method, path, body) {
    const res = await this.fetch(`${this.apiBase}${path}`, {
      method,
      headers: { ...this.headers(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: redact(text) };
    }
    return { status: res.status, json: parsed, text };
  }

  // 404 -> {content:null, sha:null}；其余非 2xx 抛 GitHubError
  async getFile(path, ref) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const { status, json } = await this.call(
      "GET",
      `${this.base()}/contents/${encodeURI(path)}${q}`,
    );
    if (status === 404) return { content: null, sha: null, json: null };
    if (status >= 400) throw new GitHubError(status, json, path);
    const raw = json?.content ? b64ToBytes(json.content) : null;
    return {
      content: raw ? utf8Decode(raw) : "",
      bytes: raw,
      sha: json?.sha ?? null,
      json,
    };
  }

  async getJson(path, ref) {
    const f = await this.getFile(path, ref);
    if (f.content === null) return null;
    try {
      return JSON.parse(f.content);
    } catch {
      return null;
    }
  }

  async getText(path, ref) {
    const f = await this.getFile(path, ref);
    return f.content === null ? null : f.content;
  }

  async getBytes(path, ref) {
    const f = await this.getFile(path, ref);
    return f.content === null ? null : f.bytes;
  }

  async listDir(path, ref) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const { status, json } = await this.call(
      "GET",
      `${this.base()}/contents/${encodeURI(path)}${q}`,
    );
    if (status === 404) return [];
    if (status >= 400) throw new GitHubError(status, json, path);
    if (!Array.isArray(json)) throw new GitHubError(200, { message: "not a directory" }, path);
    return json
      .filter((e) => e && e.type === "file")
      .map((e) => ({ name: e.name, path: e.path, sha: e.sha, size: e.size }));
  }

  async put({ path, content, sha, message, author }) {
    if (!sha) {
      // 缺 sha 就先读一次：覆盖必须基于当前版本，否则并发写会静默吃掉对方的改动
      const cur = await this.getFile(path);
      sha = cur.sha;
    }
    const body = {
      message,
      content: bytesToB64(
        typeof content === "string" ? new TextEncoder().encode(content) : content,
      ),
      branch: this.branch,
    };
    if (sha) body.sha = sha;
    if (author) body.author = author;
    const { status, json } = await this.call(
      "PUT",
      `${this.base()}/contents/${encodeURI(path)}`,
      body,
    );
    if (status >= 400) throw new GitHubError(status, json, path);
    return { sha: json?.commit?.sha ?? null, url: json?.commit?.html_url ?? null, file_sha: json?.content?.sha ?? null };
  }

  async remove({ path, sha, message, author }) {
    if (!sha) throw new GitHubError(400, { message: "删除需要 sha" }, path);
    const body = { message, sha, branch: this.branch };
    if (author) body.author = author;
    const { status, json } = await this.call(
      "DELETE",
      `${this.base()}/contents/${encodeURI(path)}`,
      body,
    );
    if (status >= 400) throw new GitHubError(status, json, path);
    return { sha: json?.commit?.sha ?? null, url: json?.commit?.html_url ?? null };
  }

  // files: [{ path, content|null (null=删除) }]。逐文件一次提交（多文件 contents 端点已废弃）。
  // sha 默认现读；冲突时对该文件重读 sha 再试一次。
  async commit({ files, message, author }) {
    const changed = [];
    let last = null;
    for (const f of files) {
      let attempt = 0;
      for (;;) {
        attempt += 1;
        const current = await this.getFile(f.path);
        let res;
        try {
          res =
            f.content === null
              ? await this.remove({ path: f.path, sha: current.sha, message, author })
              : await this.put({ path: f.path, content: f.content, sha: current.sha, message, author });
        } catch (e) {
          if (e instanceof GitHubError && e.status === 409 && attempt < 2) continue;
          if (e instanceof GitHubError) {
            e.message = `${e.message} (file ${f.path}, attempt ${attempt}): ${redact(
              JSON.stringify(e.body),
            )}`;
          }
          throw e;
        }
        if (res.sha) last = res;
        changed.push(f.path);
        break;
      }
    }
    return {
      sha: last ? last.sha : null,
      url: last ? last.url : null,
      changed_files: changed.sort(),
    };
  }
}

export { b64ToBytes, bytesToB64, redact };
