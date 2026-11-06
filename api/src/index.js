// lotus-muse-api —— 唯一持特权的那只手。
// Muse 只看到「一个 HTTPS JSON 接口 + 一把 Bearer Token」；GitHub 与 Cloudflare 的凭据
// 只存在于 Worker 绑定里，永不出现在任何响应中。
//
// 写操作顺序恒为：校验 -> 快照 content/ 到 backups/ -> 改 content/ -> 追加 journal
//                -> 重建 site/ -> 提交 GitHub -> 提交成功后才直传 Pages。
// GitHub 失败即整体失败且不部署，避免仓库与线上漂移。

import { buildRouter, json, err, bearer, tokenEquals, SCOPES } from "../../lib/http.mjs";
import { GitHubClient, GitHubError } from "./gh.mjs";
import { PagesClient } from "./pages.mjs";
import { fallbackState } from "./fallback-state.mjs";
import {
  normalizeSite,
  normalizeEntry,
  normalizePage,
  validateEntryInput,
  validatePageInput,
  seqName,
  slugify,
  assertSafeRelPath,
  ModelError,
} from "../../lib/model.mjs";
import { buildSite } from "../../lib/build.mjs";
import { makeEvent } from "../../lib/journal.mjs";

const MEDIA_PER_FILE = 5 * 1024 * 1024;
const MEDIA_TOTAL = 10 * 1024 * 1024;
const READ_CACHE_MS = 20_000;

const readCache = new Map();

function nowIso() {
  return new Date().toISOString();
}

function backupName(iso) {
  return `backups/${iso.replace(/[:.]/g, "-")}`;
}

function envDefaults(env) {
  return {
    owner: env.GITHUB_OWNER || "smartlotus",
    repo: env.GITHUB_REPO || "lotus-muse-site",
    branch: env.GITHUB_BRANCH || "main",
    baseUrl: (env.PUBLIC_BASE_URL || "https://lotus-muse-site.pages.dev").replace(/\/+$/, ""),
    account: env.CLOUDFLARE_ACCOUNT_ID || "",
    project: env.PAGES_PROJECT || "lotus-muse-site",
  };
}

function isLive(env) {
  return Boolean(env.GITHUB_TOKEN);
}

function ghClient(env, fetchImpl) {
  const d = envDefaults(env);
  return new GitHubClient({
    token: env.GITHUB_TOKEN,
    owner: d.owner,
    repo: d.repo,
    branch: d.branch,
    fetchImpl,
  });
}

function pagesClient(env, fetchImpl) {
  const token = env.CLOUDFLARE_API_TOKEN || env.CF_PAGES_TOKEN;
  const d = envDefaults(env);
  if (!token || !d.account) return null;
  return new PagesClient({
    token,
    accountId: d.account,
    project: d.project,
    branch: d.branch,
    fetchImpl,
  });
}

function fail(code, message, extra) {
  return err(code, message, extra);
}

function validationFailure(v) {
  return fail("invalid_input", "请求体不符合内容模型", { details: { errors: v.errors } });
}

// ---- 读仓库状态 -----------------------------------------------------------

async function loadState(gh, cached) {
  const key = "state";
  if (cached) {
    const hit = readCache.get(key);
    if (hit && Date.now() - hit.at < READ_CACHE_MS) return hit.value;
  }
  const siteRaw = await gh.getJson("content/site.json");
  if (!siteRaw) throw Object.assign(new Error("content/site.json 不存在"), { code: "not_found" });
  const site = normalizeSite(siteRaw);

  const entries = [];
  for (const f of await gh.listDir("content/entries")) {
    if (!f.name.endsWith(".json")) continue;
    const raw = await gh.getJson(f.path);
    if (raw) entries.push(normalizeEntry(raw));
  }
  entries.sort((a, b) => a.sequence - b.sequence);

  const pages = [];
  for (const f of await gh.listDir("content/pages")) {
    if (!f.name.endsWith(".json")) continue;
    const raw = await gh.getJson(f.path);
    if (raw) pages.push(normalizePage(raw));
  }
  pages.sort((a, b) => (a.slug < b.slug ? -1 : 1));

  const journalText = (await gh.getText("content/journal.jsonl")) || "";
  const value = {
    site,
    entries,
    pages,
    journal: journalText.split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } }),
  };
  if (cached) readCache.set(key, { at: Date.now(), value });
  return value;
}

async function listMedia(gh) {
  // 只取 content 里被引用到的媒体，避免整树遍历
  const wanted = new Set();
  const dirs = [];
  const walk = async (p) => {
    const items = await gh.listDir(p);
    for (const it of items) {
      if (wanted.size >= 200) return;
      dirs.push(it.path);
    }
  };
  return { dirs, wanted };
}

async function collectMediaPaths(gh, state) {
  const paths = new Set();
  for (const e of state.entries) for (const im of e.images || []) if (im.path) paths.add(im.path);
  for (const p of state.pages) for (const im of p.images || []) if (im.path) paths.add(im.path);
  return [...paths].sort();
}

// ---- 产物构建 -------------------------------------------------------------

function buildFiles(state, extraMedia = []) {
  const mediaPaths = [];
  for (const m of extraMedia) mediaPaths.push({ path: m.relPath, content: m.bytes });
  const built = buildSite({
    site: state.site,
    entries: state.entries,
    pages: state.pages,
    mediaPaths,
  });
  return built;
}

function plannedFrom(files) {
  return Object.entries(files)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, content]) => ({
      path,
      bytes: typeof content === "string" ? content.length : content.byteLength,
    }));
}

// ---- 写操作核心 -----------------------------------------------------------

// mutate(state) -> { entries?, pages?, site?, deleted: [paths], note, target }
async function commitMutation(env, request, state, mutate, action, target, note) {
  const d = envDefaults(env);
  const live = isLive(env);
  const gh = live ? ghClient(env, env.__fetch) : null;
  const ts = nowIso();
  const bdir = backupName(ts);
  const actor = "muse";

  const next = {
    site: state.site,
    entries: state.entries.map((e) => ({ ...e })),
    pages: state.pages.map((p) => ({ ...p })),
  };
  const result = mutate(next, ts);
  if (result && result.failure) return result.failure;

  const files = {};      // repo path -> string content（null 表示删除）
  const extraMedia = [];

  // 1. 快照：把当前 content/ 整树复制到 backups/<ts>/
  const snapshot = {};
  snapshot[`${bdir}/content/site.json`] = JSON.stringify(state.site, null, 2) + "\n";
  for (const e of state.entries) {
    snapshot[`${bdir}/content/entries/${seqName(e.sequence)}.json`] =
      (await gh?.getFile(`content/entries/${seqName(e.sequence)}.json`))?.content ??
      JSON.stringify(e, null, 2) + "\n";
  }
  for (const p of state.pages) {
    snapshot[`${bdir}/content/pages/${p.slug}.json`] =
      (await gh?.getFile(`content/pages/${p.slug}.json`)?.content) ??
      JSON.stringify(p, null, 2) + "\n";
  }
  if (!live) {
    // dry-run 也要能证明快照这件事：用内存里的等价内容
    for (const e of state.entries) {
      snapshot[`${bdir}/content/entries/${seqName(e.sequence)}.json`] =
        JSON.stringify(e, null, 2) + "\n";
    }
    for (const p of state.pages) {
      snapshot[`${bdir}/content/pages/${p.slug}.json`] = JSON.stringify(p, null, 2) + "\n";
    }
  }
  Object.assign(files, snapshot);

  // 2. 内容
  files["content/site.json"] = JSON.stringify(next.site, null, 2) + "\n";
  for (const e of next.entries) {
    files[`content/entries/${seqName(e.sequence)}.json`] = JSON.stringify(e, null, 2) + "\n";
  }
  for (const p of next.pages) {
    files[`content/pages/${p.slug}.json`] = JSON.stringify(p, null, 2) + "\n";
  }
  for (const path of result.deleted || []) {
    assertSafeRelPath(path);
    files[path] = null;
  }
  for (const m of result.media || []) {
    assertSafeRelPath(m.path, ["media/"]);
    files[m.path] = m.bytes;
    extraMedia.push({ relPath: m.path.slice("media/".length), bytes: m.bytes });
  }

  // 3. journal（追加）
  const journalLines = state.journal
    .filter((j) => j && (j.ts || j.raw))
    .map((j) => (j.raw ? j.raw : JSON.stringify(j)));
  const event = makeEvent({
    ts,
    actor,
    action,
    target,
    backup: bdir,
    ok: true,
    note: note || "",
  });
  const journalBody = [...journalLines, JSON.stringify(event)].join("\n") + "\n";
  files["content/journal.jsonl"] = journalBody;

  // 4. 重建产物
  const nextState = {
    site: next.site,
    entries: [...next.entries].sort((a, b) => a.sequence - b.sequence),
    pages: [...next.pages].sort((a, b) => (a.slug < b.slug ? -1 : 1)),
  };
  const built = buildSite({
    site: nextState.site,
    entries: nextState.entries,
    pages: nextState.pages,
    mediaPaths: extraMedia.map((m) => ({ path: m.relPath, content: m.bytes })),
  });
  for (const [path, content] of Object.entries(built.files)) {
    assertSafeRelPath(path, ["site/"]);
    files[path] = content;
  }
  // 删除不再存在的旧产物页（仅 site/ 前缀内）
  for (const path of result.removedSiteFiles || []) {
    assertSafeRelPath(path, ["site/"]);
    files[path] = null;
  }

  const sortedPaths = Object.keys(files).sort();
  const siteFiles = {};
  for (const p of sortedPaths) if (p.startsWith("site/") && files[p] !== null) siteFiles[p] = files[p];

  if (!live) {
    return {
      response: json({
        ok: true,
        mode: "dry-run",
        reason: "Worker 未配置 GITHUB_TOKEN，未写入仓库",
        planned_files: sortedPaths.map((path) => ({
          path,
          bytes: files[path] === null ? 0
            : typeof files[path] === "string" ? files[path].length : files[path].byteLength,
        })),
        planned_backup: bdir,
        journal: event,
        deploy: { url: `${d.baseUrl}${result.url_path || "/"}`, uploaded: false },
        ...result.echo,
      }),
    };
  }

  // 5. 提交 GitHub
  let commit;
  try {
    commit = await gh.commit({
      files: sortedPaths.map((path) => ({ path, content: files[path] })),
      message: `${action}: ${target}${note ? ` — ${note}` : ""}\n\nvia lotus-muse-api`,
      author: { name: "lotus-muse-bot", email: "lotus-muse-bot@users.noreply.github.com" },
    });
  } catch (e) {
    if (e instanceof GitHubError) {
      if (e.status === 401 || e.status === 403) {
        return { response: fail("github_unauthenticated", "GitHub 凭据无效或被拒，未部署") };
      }
      return { response: fail("github_failed", "GitHub 提交失败，站点未变更", { details: { status: e.status } }) };
    }
    throw e;
  }

  // 6. 部署 Pages（提交成功之后）
  const p = pagesClient(env, env.__fetch);
  let deploy = { uploaded: false, url: `${d.baseUrl}${result.url_path || "/"}`, note: "未配置 Pages 凭据，仅提交仓库" };
  if (p) {
    try {
      const mediaList = await collectMediaPaths(gh, nextState);
      const withMedia = { ...siteFiles };
      let mediaBytes = 0;
      let mediaOmitted = 0;
      for (const mp of mediaList) {
        const b = await gh.getBytes(mp);
        if (!b) { mediaOmitted += 1; continue; }
        mediaBytes += b.byteLength;
        if (mediaBytes > MEDIA_TOTAL) { mediaOmitted += 1; continue; }
        withMedia[`site/assets/${mp.slice("media/".length)}`] = b;
      }
      for (const m of extraMedia) withMedia[`site/assets/${m.relPath}`] = m.bytes;
      const up = await p.deploy(withMedia, { commitMessage: commit.sha });
      const ready = up.deployment_id ? await p.waitUntilReady(up.deployment_id) : null;
      deploy = {
        uploaded: true,
        url: up.url || deploy.url,
        deployment_id: up.deployment_id,
        environment: up.environment,
        stage: ready ? ready.deployment_stage : "queued",
        files: Object.keys(withMedia).length,
        media_omitted: mediaOmitted,
      };
    } catch (e) {
      return {
        response: fail("internal", `仓库已提交但 Pages 部署失败：${e.message}`, {
          details: { commit_sha: commit.sha, commit_url: commit.url },
        }),
      };
    }
  }

  return {
    response: json({
      ok: true,
      mode: "live",
      commit_sha: commit.sha,
      commit_url: commit.url,
      changed_files: commit.changed_files,
      journal: event,
      deploy,
      ...result.echo,
    }),
  };
}

// ---- 各路由 ---------------------------------------------------------------

function imageToMedia(img, dateForDir) {
  const dir = `media/${dateForDir}`;
  if (typeof img.base64 === "string" && img.base64.length) {
    const raw = atob(img.base64.replace(/\s/g, ""));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    if (bytes.byteLength > MEDIA_PER_FILE) {
      return { failure: fail("too_large", `单张图片超过 ${MEDIA_PER_FILE} 字节上限`) };
    }
    const name = slugify(String(img.name || img.path || "image")
      .replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, "")) || "image";
    const ext = (/\.([a-zA-Z0-9]+)$/.exec(String(img.path || img.name || "")) || [])[1] || "png";
    const path = `${dir}/${name}-${(img.__hash || Math.random().toString(36).slice(2, 8))}.${ext.toLowerCase()}`;
    return { path, bytes };
  }
  if (typeof img.path === "string" && img.path) {
    try {
      assertSafeRelPath(img.path, ["media/"]);
    } catch (e) {
      return { failure: fail("unsafe_path", e.message) };
    }
    return { existing: img.path, alt: img.alt };
  }
  return { failure: fail("invalid_input", "images[] 需要 path 或 base64") };
}

const routes = [
  {
    method: "GET", pattern: "/health", auth: false,
    async handler({ env, state }) {
      return json({
        ok: true,
        mode: isLive(env) ? "live" : "dry-run",
        repo: `${envDefaults(env).owner}/${envDefaults(env).repo}`,
        base_url: envDefaults(env).baseUrl,
        counts: { entries: state.entries.length, pages: state.pages.length },
        server_time: nowIso(),
      });
    },
  },
  {
    method: "GET", pattern: "/capabilities", auth: true,
    async handler({ state }) {
      return json({
        ok: true,
        token_valid: true,
        identity: "muse",
        scopes: SCOPES,
        limits: { images_max: 20, image_bytes_max: MEDIA_PER_FILE, body_chars_max: 20000 },
        next_sequence: state.site.next_sequence,
      });
    },
  },
  {
    method: "GET", pattern: "/site", auth: false,
    async handler({ env, state }) {
      return json({
        ok: true,
        site: state.site,
        stats: {
          entries: state.entries.length,
          pages: state.pages.length,
          last_event: state.journal[state.journal.length - 1] || null,
        },
        base_url: envDefaults(env).baseUrl,
      });
    },
  },
  {
    method: "GET", pattern: "/entries", auth: false,
    async handler({ state }) {
      return json({
        ok: true,
        entries: state.entries.map((e) => ({
          sequence: e.sequence,
          id: e.id,
          date: e.date,
          time_label: e.time_label,
          title: e.title,
          tags: e.tags,
          images: (e.images || []).length,
          url: `/entries/${seqName(e.sequence)}.html`,
          updated_at: e.updated_at,
        })),
      });
    },
  },
  {
    method: "GET", pattern: "/entries/:seq", auth: false,
    async handler({ params, state }) {
      const seq = Number(params.seq);
      const found = state.entries.find((e) => e.sequence === seq || seqName(e.sequence) === params.seq);
      if (!found) return fail("not_found", `没有第 ${params.seq} 条记录`);
      return json({ ok: true, entry: found, url: `/entries/${seqName(found.sequence)}.html` });
    },
  },
  {
    method: "GET", pattern: "/pages", auth: false,
    async handler({ state }) {
      return json({
        ok: true,
        pages: state.pages.map((p) => ({ slug: p.slug, title: p.title, nav: p.nav, url: `/pages/${p.slug}.html` })),
      });
    },
  },
  {
    method: "GET", pattern: "/journal", auth: false,
    async handler({ url, state }) {
      const n = Math.min(Math.max(Number(url.searchParams.get("limit") || 20), 1), 100);
      return json({ ok: true, events: state.journal.slice(-n).reverse() });
    },
  },
  {
    method: "POST", pattern: "/entries", auth: true,
    async handler({ request, env, state }) {
      const body = await readJson(request);
      if (body.__failure) return body.__failure;
      const v = validateEntryInput(body);
      if (!v.ok) return validationFailure(v);
      if (body.expect_sequence != null && body.expect_sequence !== state.site.next_sequence) {
        return fail("conflict_sequence", "序号与你上次读到的不一致，请重新 GET /site 后再试", {
          details: { actual: state.site.next_sequence, sent: body.expect_sequence },
        });
      }
      const seq = state.site.next_sequence;
      const media = [];
      for (const img of body.images || []) {
        const m = imageToMedia(img, isoDateDir(body.date));
        if (m.failure) return m.failure;
        if (m.bytes) media.push(m);
      }
      const entry = normalizeEntry(
        { ...body, images: [ ...(body.images || []).filter((i) => i.path).map((i) => ({ path: i.path, alt: i.alt || "日志图片" })),
            ...media.map((m) => ({ path: m.path, alt: m.alt || "日志图片" })) ] },
        { sequence: seq, id: newId(), created_at: nowIso(), updated_at: nowIso(), source: "muse", author: "lotus-muse-bot" },
      );
      return commitMutation(
        env, request, state,
        (next) => {
          next.entries.push(entry);
          next.site = normalizeSite({ ...next.site, next_sequence: seq + 1, updated_at: nowIso() });
          return {
            deleted: [],
            media,
            url_path: `/entries/${seqName(seq)}.html`,
            echo: { entry },
            target: seqName(seq),
          };
        },
        "entry.create", seqName(seq), body.note,
      );
    },
  },
  {
    method: "PUT", pattern: "/entries/:seq", auth: true,
    async handler({ request, params, env, state }) {
      const seq = Number(params.seq);
      const found = state.entries.find((e) => e.sequence === seq);
      if (!found) return fail("not_found", `没有第 ${seq} 条记录`);
      const body = await readJson(request);
      if (body.__failure) return body.__failure;
      const v = validateEntryInput({ ...found, ...body, body: body.body ?? found.body });
      if (!v.ok) return validationFailure(v);
      const merged = normalizeEntry(
        { ...found, ...body, sequence: found.sequence, id: found.id, created_at: found.created_at,
          updated_at: nowIso(), source: "muse", author: "lotus-muse-bot" },
        { sequence: found.sequence, id: found.id },
      );
      return commitMutation(
        env, request, state,
        (next) => {
          const i = next.entries.findIndex((e) => e.sequence === seq);
          next.entries[i] = merged;
          next.site = normalizeSite({ ...next.site, updated_at: nowIso() });
          return { deleted: [], media: [], url_path: `/entries/${seqName(seq)}.html`, echo: { entry: merged } };
        },
        "entry.update", seqName(seq), body.note,
      );
    },
  },
  {
    method: "DELETE", pattern: "/entries/:seq", auth: true,
    async handler({ request, params, env, state }) {
      const seq = Number(params.seq);
      const found = state.entries.find((e) => e.sequence === seq);
      if (!found) return fail("not_found", `没有第 ${seq} 条记录`);
      return commitMutation(
        env, request, state,
        (next) => {
          next.entries = next.entries.filter((e) => e.sequence !== seq);
          next.site = normalizeSite({ ...next.site, updated_at: nowIso() });
          return {
            deleted: [`content/entries/${seqName(seq)}.json`, `site/entries/${seqName(seq)}.html`],
            media: [], url_path: "/", echo: { removed_sequence: seq },
          };
        },
        "entry.delete", seqName(seq), (await readJson(request).catch(() => ({})))?.note,
      );
    },
  },
  {
    method: "POST", pattern: "/pages", auth: true,
    async handler({ request, env, state }) {
      const body = await readJson(request);
      if (body.__failure) return body.__failure;
      let v = validatePageInput(body);
      if (!v.ok) return validationFailure(v);
      const slug = slugify(body.slug || body.title);
      if (state.pages.some((p) => p.slug === slug)) {
        return fail("invalid_input", `已有同名页面 ${slug}`, { details: { errors: [{ field: "slug", message: "重复" }] } });
      }
      const page = normalizePage({ ...body, slug, id: newId(), created_at: nowIso(), updated_at: nowIso(), source: "muse", author: "lotus-muse-bot" });
      return commitMutation(
        env, request, state,
        (next) => {
          next.pages.push(page);
          next.site = normalizeSite({ ...next.site, updated_at: nowIso() });
          return { deleted: [], media: [], url_path: `/pages/${slug}.html`, echo: { page } };
        },
        "page.create", slug, body.note,
      );
    },
  },
  {
    method: "PUT", pattern: "/pages/:slug", auth: true,
    async handler({ request, params, env, state }) {
      const found = state.pages.find((p) => p.slug === params.slug);
      if (!found) return fail("not_found", `没有页面 ${params.slug}`);
      const body = await readJson(request);
      if (body.__failure) return body.__failure;
      const v = validatePageInput({ ...found, ...body, body: body.body ?? found.body });
      if (!v.ok) return validationFailure(v);
      const merged = normalizePage({ ...found, ...body, slug: found.slug, id: found.id, created_at: found.created_at, updated_at: nowIso(), source: "muse", author: "lotus-muse-bot" });
      return commitMutation(
        env, request, state,
        (next) => {
          const i = next.pages.findIndex((p) => p.slug === found.slug);
          next.pages[i] = merged;
          return { deleted: [], media: [], url_path: `/pages/${found.slug}.html`, echo: { page: merged } };
        },
        "page.update", found.slug, body.note,
      );
    },
  },
  {
    method: "DELETE", pattern: "/pages/:slug", auth: true,
    async handler({ request, params, env, state }) {
      const found = state.pages.find((p) => p.slug === params.slug);
      if (!found) return fail("not_found", `没有页面 ${params.slug}`);
      const body = await readJson(request).catch(() => ({}));
      return commitMutation(
        env, request, state,
        (next) => {
          next.pages = next.pages.filter((p) => p.slug !== found.slug);
          return {
            deleted: [`content/pages/${found.slug}.json`, `site/pages/${found.slug}.html`],
            media: [], url_path: "/", echo: { removed_slug: found.slug },
          };
        },
        "page.delete", found.slug, body?.note,
      );
    },
  },
  {
    method: "POST", pattern: "/actions/republish", auth: true,
    async handler({ request, env, state }) {
      return commitMutation(
        env, request, state,
        () => ({ deleted: [], media: [], url_path: "/", echo: { republished: true } }),
        "republish", state.site.slug, (await readJson(request).catch(() => ({})))?.note,
      );
    },
  },
  {
    method: "POST", pattern: "/actions/restore", auth: true,
    async handler({ request, env, state }) {
      const body = await readJson(request);
      if (body.__failure) return body.__failure;
      if (!body.backup) return fail("invalid_input", "需要 backup 路径，例如 backups/2026-11-06T07-00-00Z");
      let dir;
      try { dir = assertSafeRelPath(String(body.backup), ["backups/"]); }
      catch (e) { return fail("unsafe_path", e.message); }
      if (!isLive(env)) return fail("github_unauthenticated", "restore 需要仓库读取，当前是 dry-run");
      const gh = ghClient(env, env.__fetch);
      let restored;
      try { restored = await loadFromBackup(gh, dir); }
      catch (e) { return fail("not_found", `快照不可读：${e.message}`); }
      if (!restored.site) return fail("not_found", "快照里没有 content/site.json");
      return commitMutation(
        env, request, state,
        (next) => {
          const paths = [];
          for (const e of state.entries) if (!restored.entries.some((r) => r.sequence === e.sequence)) paths.push(`content/entries/${seqName(e.sequence)}.json`);
          for (const p of state.pages) if (!restored.pages.some((r) => r.slug === p.slug)) paths.push(`content/pages/${p.slug}.json`);
          for (const e of state.entries) {
            const hit = restored.entries.find((r) => r.sequence === e.sequence);
            if (hit) Object.assign(e, hit);
          }
          for (const p of state.pages) {
            const hit = restored.pages.find((r) => r.slug === p.slug);
            if (hit) Object.assign(p, hit);
          }
          next.entries = restored.entries.map((e) => ({ ...e }));
          next.pages = restored.pages.map((p) => ({ ...p }));
          next.site = normalizeSite(restored.site);
          return { deleted: paths, media: [], url_path: "/", echo: { restored_from: dir } };
        },
        "restore", dir, body.note,
      );
    },
  },
  {
    method: "POST", pattern: "/actions/rollback-entry", auth: true,
    async handler({ request, env, state }) {
      const body = await readJson(request);
      if (body.__failure) return body.__failure;
      const seq = Number(body.sequence);
      if (!state.entries.some((e) => e.sequence === seq)) return fail("not_found", `没有第 ${seq} 条记录`);
      if (!body.backup || !isLive(env)) return fail("invalid_input", "需要 backup 路径，且 restore 只能在 live 模式执行");
      let dir;
      try { dir = assertSafeRelPath(String(body.backup), ["backups/"]); }
      catch (e) { return fail("unsafe_path", e.message); }
      const gh = ghClient(env, env.__fetch);
      let snap;
      try { snap = await gh.getJson(`${dir}/content/entries/${seqName(seq)}.json`); }
      catch { snap = null; }
      if (!snap) return fail("not_found", `快照里没有第 ${seq} 条记录`);
      const entry = normalizeEntry(snap, { sequence: seq });
      return commitMutation(
        env, request, state,
        (next) => {
          const i = next.entries.findIndex((e) => e.sequence === seq);
          next.entries[i] = entry;
          return { deleted: [], media: [], url_path: `/entries/${seqName(seq)}.html`, echo: { entry } };
        },
        "restore", seqName(seq), body.note,
      );
    },
  },
];

const router = buildRouter(routes);

async function readJson(request) {
  try {
    const t = await request.text();
    if (!t) return {};
    const parsed = JSON.parse(t);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { __failure: fail("invalid_input", "请求体必须是 JSON 对象") };
    }
    return parsed;
  } catch (e) {
    return { __failure: fail("invalid_input", `请求体不是合法 JSON：${e.message}`) };
  }
}

async function loadFromBackup(gh, dir) {
  const site = await gh.getJson(`${dir}/content/site.json`);
  const entries = [];
  for (const f of await gh.listDir(`${dir}/content/entries`)) {
    if (!f.name.endsWith(".json")) continue;
    const raw = await gh.getJson(f.path);
    if (raw) entries.push(normalizeEntry(raw));
  }
  const pages = [];
  for (const f of await gh.listDir(`${dir}/content/pages`)) {
    if (!f.name.endsWith(".json")) continue;
    const raw = await gh.getJson(f.path);
    if (raw) pages.push(normalizePage(raw));
  }
  return { site, entries: entries.sort((a, b) => a.sequence - b.sequence), pages: pages.sort((a, b) => (a.slug < b.slug ? -1 : 1)) };
}

function newId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function isoDateDir(date) {
  // "2026.11.6" / "2026-11-06" -> "2026-11-06"
  const parts = String(date || "").split(/[.\-/]/).map((s) => s.trim());
  const [y, m, d] = parts;
  if (!y || !m || !d) return new Date().toISOString().slice(0, 10);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const matched = router.match(request.method, url.pathname);
  if (!matched) return fail("not_found", `没有这个接口：${request.method} ${url.pathname}`);
  if (matched.wrongMethod) return fail("method_not_allowed", `${url.pathname} 不接受 ${request.method}`);
  const { route, params } = matched;

  if (route.auth) {
    if (!env.MUSE_API_TOKEN) return fail("unauthorized", "Worker 未配置 MUSE_API_TOKEN，写接口一律关闭");
    if (!tokenEquals(bearer(request), env.MUSE_API_TOKEN)) {
      return fail("unauthorized", "Bearer Token 不正确");
    }
    if (env.MUSE_API_TOKEN.split("").length > 0 && !bearer(request)) return fail("unauthorized", "缺少 Authorization");
  }

  const cached = !route.auth;
  let state;
  try {
    if (isLive(env)) {
      state = env.__state || (await loadState(ghClient(env, env.__fetch), cached));
    } else if (env.__state) {
      state = env.__state;
    } else {
      // dry-run：没有仓库凭据时用随 Worker 打包的内容快照，
      // 这样 Muse 那一侧仍然能验证鉴权、校验、序号与 planned_files 是否完整。
      state = await fallbackState();
    }
  } catch (e) {
    if (e && e.code === "not_found") return fail("not_found", "仓库里还没有 content/site.json，请先运行 scripts/lotus.mjs init");
    if (e instanceof GitHubError && (e.status === 401 || e.status === 403)) return fail("github_unauthenticated", "GitHub 凭据无效");
    if (e instanceof ModelError) return fail("invalid_input", `仓库内容与模型不符：${e.message}`);
    return fail("internal", `读取仓库失败：${e && e.message ? e.message : String(e)}`);
  }

  try {
    const res = await route.handler({ request, env, ctx, params, url, state });
    // commitMutation 返回 { response }，这里统一拆包，避免把包装对象当 Response 返回给运行时
    if (res && !(res instanceof Response) && res.response instanceof Response) return res.response;
    if (res instanceof Response) return res;
    return json({ ok: true, ...res });
  } catch (e) {
    if (e instanceof ModelError) return fail("invalid_input", e.message);
    return fail("internal", `处理失败：${e && e.message ? e.message : String(e)}`);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          allow: "GET, POST, PUT, DELETE, OPTIONS",
          "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
          "access-control-allow-headers": "authorization, content-type, idempotency-key",
          "access-control-max-age": "600",
        },
      });
    }
    return handle(request, env, ctx);
  },
};

export { routes, router, isLive, loadState, envDefaults };
