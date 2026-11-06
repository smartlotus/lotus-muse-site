// lib/model.mjs — 校验 + 规范化（CONTRACT §3）
//
// 纯函数：不读 process、不碰 fs、不发 fetch、不调用 Date.now()。
// 时间戳只允许由调用方传进来；没传就省略该字段，绝不自己造一个。
//
// 错误分两条通道：
//   * validateEntryInput / validatePageInput 收集全部问题，返回 {ok, errors:[{field,message}]}，
//     给 HTTP 层翻译成 invalid_input + details.errors（CONTRACT §4）。
//   * normalize* 走同一个内部检查器，但遇到任何问题直接抛 ModelError，
//     让构建/写入尽早失败，而不是静默截断或补默认值。
//     唯一例外：normalize* 不调用 "必填" 类检查（body/date 可以为空串），
//     这样 "读取历史内容再规范化" 不会因为缺省字段而崩。

export class ModelError extends Error {
  constructor(message, field, code = "invalid_input") {
    super(message);
    this.name = "ModelError";
    this.code = code;
    if (field !== undefined) this.field = field;
  }
}

export const MAX_BODY = 20000;
export const MAX_TITLE = 120;
export const MAX_TIME_LABEL = 40;
export const MAX_TAGS = 10;
export const MAX_TAG_LEN = 30;
export const MAX_IMAGES = 20;
export const MAX_ALT = 200;
export const MAX_SLUG = 60;
export const MAX_EXCERPT = 160;

const DEFAULT_PREFIXES = ["content/", "site/", "media/", "backups/"];
const MEDIA_PREFIX = ["media/"];
const MEDIA_PATH_RE = /^media\/[A-Za-z0-9._/-]+$/;
const DOTTED_DATE_RE = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SORT_DIRECTIONS = ["newest_first", "oldest_first"];
const TEMPLATES = ["article", "blank", "gallery"];

const isStr = (v) => typeof v === "string";
const has = (v) => v !== undefined && v !== null;

function asObject(value, label) {
  if (!has(value) || Array.isArray(value) || typeof value !== "object") {
    throw new ModelError(`${label} 必须是一个对象`, label);
  }
  return value;
}

function schemaVersion(raw) {
  const v = raw.schema_version;
  if (!has(v) || v === "") return 1;
  if (!Number.isInteger(v) || v < 1) throw new ModelError("schema_version 必须是正整数", "schema_version");
  return v;
}

/**
 * 只接受相对路径。拒绝：绝对路径、盘符/UNC、反斜杠、任何 `..` 段、
 * 任何前导点段（隐藏文件/目录）、空段、控制字符，以及不在允许前缀下的路径。
 * @param {string} p
 * @param {string[]} [prefixes] 允许的前缀白名单，默认 content/ site/ media/ backups/
 * @returns {string} 原样返回
 */
export function assertSafeRelPath(p, prefixes = DEFAULT_PREFIXES) {
  const fail = (message) => new ModelError(message, "path", "unsafe_path");

  if (!isStr(p) || p.length === 0) throw fail("路径必须是非空字符串");
  if (p.includes("\0") || /[\u0001-\u001f\u007f]/.test(p)) throw fail("路径含控制字符");
  if (p.includes("\\")) throw fail("路径禁止使用反斜杠");
  if (p.startsWith("/")) throw fail("禁止绝对路径");
  if (p.startsWith("~/")) throw fail("禁止家目录展开");
  if (p.includes(":")) throw fail("禁止盘符 / UNC / 协议前缀");
  if (/^\/{2,}/.test(p)) throw fail("禁止 UNC 路径");

  const segments = p.split("/");
  for (const seg of segments) {
    if (seg === "") throw fail("路径含空段（连续的 / 或结尾的 /）");
    if (seg === "..") throw fail("路径穿越：禁止 .. 段");
    if (seg.startsWith(".")) throw fail("路径段不允许以点开头");
  }

  const list = (Array.isArray(prefixes) ? prefixes : [prefixes])
    .filter(isStr)
    .filter((x) => x.length > 0)
    .map((x) => (x.endsWith("/") ? x : `${x}/`));
  if (list.length === 0) throw fail("没有可用的写入前缀白名单");
  if (!list.some((pre) => p.startsWith(pre))) {
    throw fail(`路径不在允许的写入前缀内（仅允许 ${list.join(" ")}）`);
  }
  return p;
}

/** 7 -> "0007"；序号一经分配永不改变，也不允许 4 位以外的表示。 */
export function seqName(sequence) {
  if (!Number.isInteger(sequence)) {
    throw new ModelError(`sequence 必须是整数，收到 ${String(sequence)}`, "sequence");
  }
  if (sequence < 1) throw new ModelError(`sequence 必须从 1 开始，收到 ${sequence}`, "sequence");
  if (sequence >= 10000) {
    throw new ModelError(`sequence ${sequence} 超出 4 位序号上限 9999`, "sequence");
  }
  return String(sequence).padStart(4, "0");
}

/** 只产出 [a-z0-9-]，≤60 字符，空则 "page"。 */
export function slugify(input) {
  const raw = isStr(input) ? input : "";
  let s = raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (s.length > MAX_SLUG) s = s.slice(0, MAX_SLUG).replace(/-+$/, "");
  return s === "" ? "page" : s;
}

/** "2026.11.6" 或 "2026-11-06" -> "2026.11.6"（沿用旧站的点分形式）；空 -> ""。 */
function normalizeDate(value) {
  if (!has(value)) return "";
  if (!isStr(value)) throw new ModelError("date 必须是字符串", "date");
  const v = value.trim();
  if (v === "") return "";
  let m = DOTTED_DATE_RE.exec(v) || ISO_DATE_RE.exec(v);
  if (!m) throw new ModelError(`date 格式无效：${value}（要求点分 YYYY.M.D 或 ISO YYYY-MM-DD）`, "date");
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12) throw new ModelError(`date 月份越界：${value}`, "date");
  if (day < 1 || day > 31) throw new ModelError(`date 日期越界：${value}`, "date");
  return `${y}.${month}.${day}`;
}

function dateIsValid(value) {
  try {
    normalizeDate(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeTags(list) {
  if (!has(list)) return [];
  if (!Array.isArray(list)) throw new ModelError("tags 必须是字符串数组", "tags");
  return list.map((t, i) => {
    if (!isStr(t)) throw new ModelError(`tags[${i}] 必须是字符串`, "tags");
    return t.trim();
  });
}

function normalizeImageList(list, field) {
  if (!has(list)) return [];
  if (!Array.isArray(list)) throw new ModelError(`${field} 必须是数组`, field);
  return list.map((img, i) => {
    const label = `${field}[${i}]`;
    if (!has(img) || typeof img !== "object" || Array.isArray(img)) {
      throw new ModelError(`${label} 必须是对象`, field);
    }
    if (!isStr(img.path) || img.path === "") throw new ModelError(`${label}.path 不能为空`, field);
    assertSafeRelPath(img.path, MEDIA_PREFIX);
    if (!MEDIA_PATH_RE.test(img.path)) throw new ModelError(`${label}.path 必须以 media/ 开头`, field);
    return {
      id: isStr(img.id) ? img.id : "",
      path: img.path,
      alt: isStr(img.alt) ? img.alt : "",
      order: Number.isInteger(img.order) ? img.order : i,
    };
  });
}

/**
 * entry 的统一检查器。required=true 时额外检查 body/date 必填。
 * @returns {{ok:boolean, errors:{field:string,message:string}[], values:{date:string}}}
 */
function entryErrors(obj, { required }) {
  const errors = [];
  const push = (field, message) => errors.push({ field, message });

  const body = obj.body;
  if (!has(body)) {
    if (required) push("body", "body 必填，长度至少 1");
  } else if (!isStr(body)) {
    push("body", "body 必须是字符串");
  } else if (body.length === 0) {
    if (required) push("body", "body 必填，长度至少 1");
  } else if (body.length > MAX_BODY) {
    push("body", `body 最长 ${MAX_BODY} 字符，收到 ${body.length}`);
  }

  const date = obj.date;
  if (!has(date)) {
    if (required) push("date", "date 必填");
  } else if (!isStr(date)) {
    push("date", "date 必须是字符串");
  } else if (date.trim() === "") {
    if (required) push("date", "date 必填");
  } else if (!dateIsValid(date)) {
    push("date", `date 格式无效（要求 YYYY.M.D 或 YYYY-MM-DD）：${date}`);
  }

  const title = obj.title;
  if (has(title) && !isStr(title)) push("title", "title 必须是字符串");
  else if (isStr(title) && title.length > MAX_TITLE) push("title", `title 最长 ${MAX_TITLE} 字符`);

  const timeLabel = obj.time_label;
  if (has(timeLabel) && !isStr(timeLabel)) push("time_label", "time_label 必须是字符串");
  else if (isStr(timeLabel) && timeLabel.length > MAX_TIME_LABEL) {
    push("time_label", `time_label 最长 ${MAX_TIME_LABEL} 字符`);
  }

  const tags = obj.tags;
  if (has(tags) && tags.length > 0 && !Array.isArray(tags)) push("tags", "tags 必须是数组");
  if (Array.isArray(tags)) {
    if (tags.length > MAX_TAGS) push("tags", `tags 最多 ${MAX_TAGS} 个`);
    tags.forEach((t, i) => {
      if (!isStr(t)) push("tags", `tags[${i}] 必须是字符串`);
      else if (t.length > MAX_TAG_LEN) push("tags", `tags[${i}] 最长 ${MAX_TAG_LEN} 字符`);
    });
  }

  const images = obj.images;
  if (has(images) && images.length > 0 && !Array.isArray(images)) push("images", "images 必须是数组");
  if (Array.isArray(images)) {
    if (images.length > MAX_IMAGES) push("images", `images 最多 ${MAX_IMAGES} 张`);
    images.forEach((img, i) => {
      const label = `images[${i}]`;
      if (!has(img) || typeof img !== "object" || Array.isArray(img)) {
        push("images", `${label} 必须是对象`);
        return;
      }
      if (!isStr(img.path) || img.path === "") {
        push("images", `${label}.path 不能为空`);
      } else {
        try {
          assertSafeRelPath(img.path, MEDIA_PREFIX);
        } catch (e) {
          push("images", `${label}.path ${e.message}`);
        }
        if (!MEDIA_PATH_RE.test(img.path)) push("images", `${label}.path 必须匹配 ^media/[A-Za-z0-9._/-]+$`);
      }
      if (has(img.alt) && !isStr(img.alt)) push("images", `${label}.alt 必须是字符串`);
      else if (isStr(img.alt) && img.alt.length > MAX_ALT) push("images", `${label}.alt 最长 ${MAX_ALT} 字符`);
    });
  }

  if (has(obj.sequence) && obj.sequence !== "") {
    try {
      seqName(obj.sequence);
    } catch (e) {
      push("sequence", e.message);
    }
  }
  if (has(obj.id) && !isStr(obj.id)) push("id", "id 必须是字符串");
  for (const field of ["created_at", "updated_at", "source", "author"]) {
    if (has(obj[field]) && !isStr(obj[field])) push(field, `${field} 必须是字符串`);
  }

  return { ok: errors.length === 0, errors, values: { date: isStr(date) && dateIsValid(date) ? normalizeDate(date) : "" } };
}

/** @returns {{ok:boolean, errors:{field:string,message:string}[]}} */
export function validateEntryInput(obj) {
  if (!has(obj) || Array.isArray(obj) || typeof obj !== "object") {
    return { ok: false, errors: [{ field: "entry", message: "请求体必须是一个对象" }] };
  }
  const r = entryErrors(obj, { required: true });
  return { ok: r.ok, errors: r.errors };
}

export function normalizeEntry(raw, opts = {}) {
  const o = asObject(raw, "entry");
  const options = asObject(opts ?? {}, "entry options");
  const sequence = has(options.sequence) ? options.sequence : o.sequence;
  if (!has(sequence) || sequence === "") throw new ModelError("entry 需要 sequence（或 options.sequence）", "sequence");

  const report = entryErrors(o, { required: false });
  if (!report.ok) throw new ModelError(report.errors.map((e) => `${e.field}: ${e.message}`).join("; "), report.errors[0].field);

  seqName(sequence);

  const out = {
    schema_version: schemaVersion(o),
    id: isStr(o.id) ? o.id : "",
    sequence,
    date: normalizeDate(o.date),
    time_label: isStr(o.time_label) ? o.time_label : "",
    title: isStr(o.title) ? o.title : "",
    body: isStr(o.body) ? o.body : "",
    images: normalizeImageList(o.images, "images"),
    tags: normalizeTags(o.tags),
  };
  if (isStr(o.created_at) && o.created_at !== "") out.created_at = o.created_at;
  if (isStr(o.updated_at) && o.updated_at !== "") out.updated_at = o.updated_at;
  if (isStr(o.source) && o.source !== "") out.source = o.source;
  if (isStr(o.author) && o.author !== "") out.author = o.author;
  return out;
}

function pageErrors(obj, { required }) {
  const errors = [];
  const push = (field, message) => errors.push({ field, message });

  const body = obj.body;
  if (!has(body) || body === "") {
    if (required) push("body", "body 必填，长度至少 1");
  } else if (!isStr(body)) push("body", "body 必须是字符串");
  else if (body.length > MAX_BODY) push("body", `body 最长 ${MAX_BODY} 字符，收到 ${body.length}`);

  for (const [field, max] of [["title", MAX_TITLE], ["subtitle", MAX_TITLE * 2]]) {
    const v = obj[field];
    if (has(v) && !isStr(v)) push(field, `${field} 必须是字符串`);
    else if (isStr(v) && v.length > max) push(field, `${field} 最长 ${max} 字符`);
  }

  const template = obj.template;
  if (has(template) && template !== "" && !TEMPLATES.includes(template)) {
    push("template", `template 只能是 ${TEMPLATES.join(" | ")}`);
  }
  const nav = obj.nav;
  if (has(nav) && typeof nav !== "boolean") push("nav", "nav 必须是布尔值");

  const slug = obj.slug;
  if (has(slug) && slug !== "" && !isStr(slug)) push("slug", "slug 必须是字符串");

  const images = obj.images;
  if (has(images) && images.length > 0 && !Array.isArray(images)) push("images", "images 必须是数组");
  if (Array.isArray(images)) {
    if (images.length > MAX_IMAGES) push("images", `images 最多 ${MAX_IMAGES} 张`);
    images.forEach((img, i) => {
      const label = `images[${i}]`;
      if (!has(img) || typeof img !== "object" || Array.isArray(img)) {
        push("images", `${label} 必须是对象`);
        return;
      }
      if (!isStr(img.path) || img.path === "") {
        push("images", `${label}.path 不能为空`);
      } else {
        try {
          assertSafeRelPath(img.path, MEDIA_PREFIX);
        } catch (e) {
          push("images", `${label}.path ${e.message}`);
        }
        if (!MEDIA_PATH_RE.test(img.path)) push("images", `${label}.path 必须匹配 ^media/[A-Za-z0-9._/-]+$`);
      }
      if (has(img.alt) && !isStr(img.alt)) push("images", `${label}.alt 必须是字符串`);
      else if (isStr(img.alt) && img.alt.length > MAX_ALT) push("images", `${label}.alt 最长 ${MAX_ALT} 字符`);
    });
  }

  for (const field of ["created_at", "updated_at", "source", "author", "id"]) {
    if (has(obj[field]) && !isStr(obj[field])) push(field, `${field} 必须是字符串`);
  }
  return { ok: errors.length === 0, errors };
}

/** @returns {{ok:boolean, errors:{field:string,message:string}[]}} */
export function validatePageInput(obj) {
  if (!has(obj) || Array.isArray(obj) || typeof obj !== "object") {
    return { ok: false, errors: [{ field: "page", message: "请求体必须是一个对象" }] };
  }
  const r = pageErrors(obj, { required: true });
  return { ok: r.ok, errors: r.errors };
}

export function normalizePage(raw) {
  const o = asObject(raw, "page");
  const r = pageErrors(o, { required: false });
  if (!r.ok) throw new ModelError(r.errors.map((e) => `${e.field}: ${e.message}`).join("; "), r.errors[0].field);

  const slugSource = isStr(o.slug) && o.slug !== "" ? o.slug : o.title;
  const out = {
    schema_version: schemaVersion(o),
    id: isStr(o.id) ? o.id : "",
    slug: slugify(slugSource),
    title: isStr(o.title) ? o.title : "",
    subtitle: isStr(o.subtitle) ? o.subtitle : "",
    body: isStr(o.body) ? o.body : "",
    template: isStr(o.template) && o.template !== "" ? o.template : "article",
    images: normalizeImageList(o.images, "images"),
    nav: typeof o.nav === "boolean" ? o.nav : false,
  };
  if (isStr(o.created_at) && o.created_at !== "") out.created_at = o.created_at;
  if (isStr(o.updated_at) && o.updated_at !== "") out.updated_at = o.updated_at;
  if (isStr(o.source) && o.source !== "") out.source = o.source;
  if (isStr(o.author) && o.author !== "") out.author = o.author;
  return out;
}

export function normalizeSite(raw) {
  const o = asObject(raw, "site");

  const sort = has(o.sort_direction) && o.sort_direction !== "" ? o.sort_direction : "newest_first";
  if (!SORT_DIRECTIONS.includes(sort)) {
    throw new ModelError(`sort_direction 只能是 ${SORT_DIRECTIONS.join(" | ")}`, "sort_direction");
  }
  const next = has(o.next_sequence) && o.next_sequence !== "" ? o.next_sequence : 1;
  if (!Number.isInteger(next) || next < 1) {
    throw new ModelError("next_sequence 必须是 >=1 的整数，且只增不减", "next_sequence");
  }
  const name = isStr(o.name) ? o.name : "";
  if (name === "") throw new ModelError("site.name 不能为空", "name");

  const out = {
    schema_version: schemaVersion(o),
    site_id: isStr(o.site_id) ? o.site_id : "",
    name,
    slug: slugify(isStr(o.slug) && o.slug !== "" ? o.slug : name),
    subtitle: isStr(o.subtitle) ? o.subtitle : "",
    sort_direction: sort,
    next_sequence: next,
    base_url: isStr(o.base_url) ? o.base_url : "",
  };
  if (isStr(o.created_at) && o.created_at !== "") out.created_at = o.created_at;
  if (isStr(o.updated_at) && o.updated_at !== "") out.updated_at = o.updated_at;
  return out;
}
