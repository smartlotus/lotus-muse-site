// 从本地 content/ 生成 api/src/fallback-state.mjs（dry-run 快照）。
// 用法：node scripts/make-fallback.mjs
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

async function readJson(p) {
  return JSON.parse(await fs.readFile(path.join(root, p), "utf8"));
}

async function listJson(dir) {
  const abs = path.join(root, dir);
  try {
    const names = (await fs.readdir(abs)).filter((n) => n.endsWith(".json")).sort();
    return await Promise.all(names.map((n) => readJson(`${dir}/${n}`)));
  } catch {
    return [];
  }
}

const site = await readJson("content/site.json");
const entries = (await listJson("content/entries")).sort((a, b) => a.sequence - b.sequence);
const pages = (await listJson("content/pages")).sort((a, b) => (a.slug < b.slug ? -1 : 1));
let journal = [];
try {
  journal = (await fs.readFile(path.join(root, "content/journal.jsonl"), "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
} catch {
  journal = [];
}

const body = `// 由 scripts/make-fallback.mjs 生成，不要手改。
export const GENERATED_AT = ${JSON.stringify(new Date().toISOString())};

export const STATE = ${JSON.stringify({ site, entries, pages, journal, fallback: true }, null, 2)};

export async function fallbackState() {
  if (!STATE.site) {
    throw Object.assign(new Error("dry-run 快照为空，请运行 node scripts/make-fallback.mjs"), {
      code: "not_found",
    });
  }
  return STATE;
}
`;

await fs.writeFile(path.join(root, "api/src/fallback-state.mjs"), body, "utf8");
console.log(
  `fallback 快照已生成：site + ${entries.length} 条记录 + ${pages.length} 个页面 + ${journal.length} 行流水`,
);
