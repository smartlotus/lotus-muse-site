// content -> 静态产物。纯函数、字节确定（同输入两次结果完全相同，产物里不写时间戳）。
// 键一律以 "site/" 开头；mediaPaths 为 [{path, content}]，content 允许字符串或 Uint8Array。
import { renderCss, renderIndex, renderEntry, renderPage } from "./template.mjs";
import { seqName } from "./model.mjs";

// 分工：校验与规范化是写入端（API / CLI）的职责，构建端只负责渲染。
// 构建里再做一次 normalize 会把写入端已确认的内容二次改写，一处缺陷就毒死整站产物，
// 所以这里只取字段、排序、渲染。

function cmpSeq(a, b) {
  return a.sequence - b.sequence;
}

function cmpSlug(a, b) {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

export function buildSite({ site, entries = [], pages = [], mediaPaths = [] } = {}) {
  if (!site || typeof site !== "object") throw new TypeError("buildSite 需要 site");
  const s = {
    schema_version: site.schema_version ?? 1,
    site_id: site.site_id ?? "",
    name: site.name ?? "未命名站点",
    slug: site.slug ?? "site",
    subtitle: site.subtitle ?? "",
    sort_direction: site.sort_direction === "oldest_first" ? "oldest_first" : "newest_first",
    next_sequence: Number(site.next_sequence) || 1,
    base_url: site.base_url ?? "",
  };
  const es = entries.filter((e) => e && Number.isFinite(Number(e.sequence))).map((e) => ({ ...e })).sort(cmpSeq);
  const ps = pages.filter((p) => p && typeof p.slug === "string").map((p) => ({ ...p })).sort(cmpSlug);

  const ordered = s.sort_direction === "oldest_first" ? es : [...es].reverse();

  const files = {};
  files["site/assets/site.css"] = renderCss();
  files["site/index.html"] = renderIndex({ site: s, entries: ordered, pages: ps });

  for (let i = 0; i < es.length; i += 1) {
    const entry = es[i];
    files[`site/entries/${seqName(entry.sequence)}.html`] = renderEntry({
      site: s,
      entry,
      prev: i > 0 ? es[i - 1] : null,
      next: i < es.length - 1 ? es[i + 1] : null,
      pages: ps,
    });
  }

  for (const page of ps) {
    files[`site/pages/${page.slug}.html`] = renderPage({ site: s, page, entries: ordered, pages: ps });
  }

  const seenMedia = new Set();
  for (const m of mediaPaths) {
    if (!m || typeof m.path !== "string" || m.content === undefined) continue;
    const rel = m.path.startsWith("media/") ? m.path.slice("media/".length) : m.path;
    const key = `site/assets/media/${rel}`;
    if (seenMedia.has(key)) continue;
    seenMedia.add(key);
    files[key] = m.content;
  }

  const sorted = {};
  for (const k of Object.keys(files).sort()) sorted[k] = files[k];

  return {
    files: sorted,
    counts: {
      entries: es.length,
      pages: ps.length,
      media: seenMedia.size,
      html: Object.keys(sorted).filter((k) => k.endsWith(".html")).length,
    },
  };
}
