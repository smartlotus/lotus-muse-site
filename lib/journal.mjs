// lib/journal.mjs — content/journal.jsonl 的事件结构（CONTRACT §2 一行的形状）
//
// 纯函数：不取时钟。ts 必须由调用方（scripts/lotus.mjs 或 Worker）传进来；
// 没传就是 null，表示"这一行的时间由写入方补齐"。lib 里没有 Date.now()，
// 这样同一批事件在任何机器上重放都得到逐字相同的 JSONL。
//
// 输出行的键顺序固定为：ts, actor, action, target, commit_sha, backup, ok, note
// —— 与 §2 完全一致，不额外塞 schema_version，避免和 §2 的行形状漂移。

import { ModelError, assertSafeRelPath } from "./model.mjs";

const ACTIONS = [
  "entry.create",
  "entry.update",
  "entry.delete",
  "page.create",
  "page.update",
  "page.delete",
  "site.update",
  "republish",
  "restore",
];
const ACTORS = ["muse", "local"];
const SHA_RE = /^[0-9a-f]{7,64}$/i;
const MAX_NOTE = 200;

const has = (v) => v !== undefined && v !== null && v !== "";

function cleanText(value, field) {
  if (!has(value)) return null;
  if (typeof value !== "string") throw new ModelError(`${field} 必须是字符串`, field);
  const v = value.replace(/[\r\n]+/g, " ").replace(/[ \t]+/g, " ").trim();
  return v === "" ? null : v;
}

/**
 * @param {object} partial
 * @returns {{ts:string|null,actor:string,action:string,target:string|null,
 *            commit_sha:string|null,backup:string|null,ok:boolean,note:string|null}}
 */
export function makeEvent(partial = {}) {
  if (!has(partial) || Array.isArray(partial) || typeof partial !== "object") {
    throw new ModelError("journal 事件必须是一个对象", "event");
  }
  const p = partial;

  if (!has(p.action)) throw new ModelError("journal 事件缺少 action", "action");
  if (typeof p.action !== "string" || !ACTIONS.includes(p.action)) {
    throw new ModelError(`未知的 journal action：${String(p.action)}（仅允许 ${ACTIONS.join(" | ")}）`, "action");
  }

  const actor = has(p.actor) ? p.actor : "local";
  if (!ACTORS.includes(actor)) {
    throw new ModelError(`未知的 journal actor：${String(actor)}（仅允许 ${ACTORS.join(" | ")}）`, "actor");
  }

  const ts = cleanText(p.ts, "ts");

  const target = cleanText(p.target, "target");
  if (target === null) throw new ModelError("journal 事件缺少 target（序号字符串或 slug）", "target");

  const commitSha = cleanText(p.commit_sha, "commit_sha");
  if (commitSha !== null && !SHA_RE.test(commitSha)) {
    throw new ModelError(`commit_sha 必须是 7~64 位十六进制：${commitSha}`, "commit_sha");
  }

  let backup = null;
  if (has(p.backup)) {
    if (typeof p.backup !== "string") throw new ModelError("backup 必须是字符串", "backup");
    try {
      assertSafeRelPath(p.backup, ["backups/"]);
    } catch (e) {
      throw new ModelError(`backup ${e.message}`, "backup", e.code);
    }
    backup = p.backup;
  }

  const ok = p.ok === undefined ? true : p.ok;
  if (typeof ok !== "boolean") throw new ModelError("ok 必须是布尔值", "ok");

  let note = cleanText(p.note, "note");
  if (note !== null && note.length > MAX_NOTE) note = note.slice(0, MAX_NOTE);

  return { ts, actor, action: p.action, target, commit_sha: commitSha, backup, ok, note };
}
