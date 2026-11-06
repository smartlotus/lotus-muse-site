#!/usr/bin/env node
// scripts/lotus.mjs: 本地 CLI，不依赖 Worker / Muse，也能完成与 Worker API 相同的内容写入与构建。
// 所有路径都相对本仓库根目录解析（从 import.meta.url 推导），在任何 cwd 下调用结果一致。
// 接口形状以 docs/CONTRACT.md 为唯一真源。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const P = (...segs) => path.join(ROOT, ...segs);
const REL = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

const CONTENT_DIR = P('content');
const ENTRIES_DIR = path.join(CONTENT_DIR, 'entries');
const PAGES_DIR = path.join(CONTENT_DIR, 'pages');
const SITE_JSON = path.join(CONTENT_DIR, 'site.json');
const JOURNAL_FILE = path.join(CONTENT_DIR, 'journal.jsonl');
const SITE_OUT_DIR = P('site');
const MEDIA_DIR = P('media');
const BACKUPS_DIR = P('backups');
const ALLOWED_PUSH_PREFIXES = ['content/', 'site/', 'media/', 'backups/'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const TEMPLATES = new Set(['article', 'blank', 'gallery']);

// ---------------------------------------------------------------- 输出与退出

function info(msg) { process.stdout.write(msg + '\n'); }
function fail(msg, code = 1) {
  process.stderr.write('错误: ' + msg + '\n');
  process.exit(code);
}
function dieValidation(errors) {
  for (const e of errors || []) {
    process.stderr.write(`校验失败: ${e.field}: ${e.message}\n`);
  }
  process.exit(1);
}

const HELP = `用法: node scripts/lotus.mjs <命令> [参数]

命令:
  init --name <名称> [--slug <slug>] [--subtitle <副标题>]
  add-entry [--date 2026.11.6] [--time 晚上] [--title <标题>]
            (--body <文字> | --body-file <路径>) [--tags a,b] [--image <路径>]... [--note <说明>]
  edit-entry <seq> [--title ...] [--time ...] [--date ...] (--body|--body-file) [--tags ...] [--note ...]
  delete-entry <seq> [--note ...]        (别名 del-entry)
  add-page <slug> [--title ...] [--template article|blank|gallery] (--body|--body-file) [--nav|--no-nav] [--note ...]
  edit-page <slug> [--title ...] [--template ...] [--subtitle ...] (--body|--body-file) [--nav|--no-nav] [--note ...]
  delete-page <slug> [--note ...]
  republish [--note ...]
  restore --backup backups/<快照目录名> [--note ...]
  status
  build                                (别名 rebuild)

写命令通用开关: --commit 生成一次 git 提交; --push 在提交后推送远端（会先拒绝工作区里
四个允许前缀 content/ site/ media/ backups/ 之外的未跟踪文件）。`;

// ---------------------------------------------------------------- CLI 解析

const VALUE_FLAGS = new Set([
  'name', 'slug', 'subtitle', 'date', 'time', 'title', 'body', 'body-file',
  'tags', 'note', 'backup', 'template', 'commit-message',
]);
const IMAGE_FLAGS = new Set(['image']);

function parseCli(argv) {
  const tokens = [...argv];
  const cmd = tokens.shift();
  const flags = {};
  const images = [];
  const positional = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-h' || t === '--help') { flags.help = true; continue; }
    if (t.startsWith('--')) {
      let key = t.slice(2);
      let val = null;
      const eq = key.indexOf('=');
      if (eq >= 0) { val = key.slice(eq + 1); key = key.slice(0, eq); }
      if (IMAGE_FLAGS.has(key)) {
        if (val == null) val = tokens[++i];
        if (val == null) fail(`--${key} 需要一个文件路径`);
        images.push(val);
        continue;
      }
      if (val == null && VALUE_FLAGS.has(key)) {
        val = tokens[++i];
        if (val == null) fail(`--${key} 需要一个值`);
      }
      flags[key] = val == null ? true : val;
    } else {
      positional.push(t);
    }
  }
  return { cmd, flags, images, positional };
}

// ---------------------------------------------------------------- lib 动态导入

async function loadLibs() {
  const need = async (...rel) => {
    try {
      return await import(pathToFileURL(P(...rel)).href);
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ERR_MODULE_NOT_FOUND')) {
        fail(`缺少 ${rel.join('/')}。它由 docs/CONTRACT.md 第 3 节定义，若 lib/ 尚未就位则本 CLI 无法工作。`);
      }
      throw err;
    }
  };
  const model = await need('lib', 'model.mjs');
  const builder = await need('lib', 'build.mjs');
  const journal = await need('lib', 'journal.mjs');
  return { model, builder, journal };
}

// ---------------------------------------------------------------- 小工具

function readJson(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    fail(`读取 ${REL(abs)} 失败: ${err.message}`);
  }
}

function writeJson(abs, obj) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function stampDir() {
  // Windows 文件名不允许冒号，所以把 ISO 时间做消毒：2026-11-06T07:00:00Z -> 2026-11-06T07-00-00Z
  return nowIso().replace(/:/g, '-');
}
function hex32() {
  return crypto.randomBytes(16).toString('hex');
}
function todayDotted() {
  const d = new Date();
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}
function dottedToDir(dateStr) {
  // "2026.11.6" 或 "2026-11-06" -> "2026-11-06"（media 子目录名）
  const parts = String(dateStr).split(/[^0-9]+/).filter(Boolean);
  if (parts.length < 3) return 'undated';
  const [y, m, d] = parts;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function splitTags(raw) {
  if (!raw) return [];
  return String(raw).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
}
function readBody(flags) {
  if (flags['body-file']) {
    const abs = path.isAbsolute(flags['body-file']) ? flags['body-file'] : P(flags['body-file']);
    if (!fs.existsSync(abs)) fail(`--body-file 不存在: ${REL(abs)}`);
    return fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  }
  if (typeof flags.body === 'string') return flags.body;
  return null;
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

// 写盘前的往返自检：normalize 一次的结果再 normalize 必须仍成立。
// 若 lib/model.mjs 的规范化产生了自己都不认的值（契约 §3 不允许），在这里拦截，
// 绝不让半成品写进 content/。
function assertEntryRoundtrip(model, entry) {
  model.normalizeEntry(JSON.parse(JSON.stringify(entry)), { sequence: entry.sequence });
}
function assertPageRoundtrip(model, page) {
  model.normalizePage(JSON.parse(JSON.stringify(page)));
}

function walkFiles(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(abs, base));
    else out.push(abs);
  }
  return out;
}

// ---------------------------------------------------------------- 内容读写

function assertSiteExists({ forInit = false } = {}) {
  if (forInit) {
    if (fs.existsSync(SITE_JSON)) {
      fail('content/site.json 已存在。init 只用于第一次建立站点；日常维护请用 add-entry / add-page 等。');
    }
    return;
  }
  if (!fs.existsSync(SITE_JSON)) {
    fail('缺少 content/site.json。请先运行: node scripts/lotus.mjs init --name <站点名>');
  }
}

function loadContent(model) {
  const rawSite = readJson(SITE_JSON);
  if (rawSite == null) fail('缺少 content/site.json。');
  const site = model.normalizeSite(rawSite);
  const entries = listJson(ENTRIES_DIR).map((f) => {
    const raw = readJson(path.join(ENTRIES_DIR, f));
    return model.normalizeEntry(raw, { sequence: raw.sequence });
  });
  const pages = listJson(PAGES_DIR).map((f) => model.normalizePage(readJson(path.join(PAGES_DIR, f))));
  return { site, entries, pages };
}

function snapshotContent() {
  const dirName = stampDir();
  const dest = path.join(BACKUPS_DIR, dirName);
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  fs.cpSync(CONTENT_DIR, dest, { recursive: true });
  return 'backups/' + dirName;
}

function appendJournal(journal, event) {
  // 契约 §3 说 makeEvent 补 ts 默认；这里显式传入以防实现缺省时行仍是完整事件。
  const made = journal.makeEvent({ ts: nowIso(), ...event });
  fs.appendFileSync(JOURNAL_FILE, JSON.stringify(made) + '\n', 'utf8');
  return made;
}

// ---------------------------------------------------------------- 构建

function buildAndWrite({ model, builder }, content) {
  const mediaPaths = walkFiles(MEDIA_DIR).map((abs) => ({ path: REL(abs), content: fs.readFileSync(abs) }));
  const result = builder.buildSite({
    site: content.site,
    entries: content.entries,
    pages: content.pages,
    mediaPaths,
  });
  const files = result.files || {};
  let textCount = 0;
  let mediaCount = 0;
  for (const [key, payload] of Object.entries(files)) {
    if (!key.startsWith('site/')) {
      fail(`buildSite 返回的键必须以 site/ 开头，收到: ${key}`);
    }
    const abs = P(...key.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (typeof payload === 'string') {
      fs.writeFileSync(abs, payload, 'utf8');
      textCount++;
    } else {
      // 媒体等二进制产物（Uint8Array/Buffer），按字节写。
      fs.writeFileSync(abs, payload);
      mediaCount++;
    }
  }
  const counts = result.counts || {};
  info(`构建完成: 文本产物 ${textCount} 个, 二进制产物 ${mediaCount} 个`);
  for (const [k, v] of Object.entries(counts)) info(`  ${k}: ${v}`);
  return result;
}

// ---------------------------------------------------------------- git

function runGit(args, opts = {}) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.error) fail(`无法执行 git: ${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) {
    fail(`git ${args.join(' ')} 失败 (退出码 ${r.status}):\n${(r.stderr || r.stdout || '').trim()}`);
  }
  return r;
}

function commitAndPush(flags, summary) {
  const wantPush = !!flags.push;
  const wantCommit = !!flags.commit || wantPush;
  if (!wantCommit) return null;

  runGit(['add', '-A']);
  const nothing = runGit(['diff', '--cached', '--quiet'], { allowFail: true }).status === 0;
  let sha = null;
  if (nothing) {
    if (flags._republish) {
      // republish 的目的就是产生一次提交以触发 Pages 重新部署，内容不变时允许空提交。
      runGit(['commit', '--allow-empty', '-m', summary]);
    } else {
      info('没有需要提交的改动。');
      return null;
    }
  } else {
    runGit(['commit', '-m', summary]); // 绝不用 --no-verify，绝不改写历史
  }
  sha = runGit(['rev-parse', 'HEAD']).stdout.trim();
  info(`已提交 ${sha}`);

  if (!wantPush) return sha;

  const untracked = runGit(['ls-files', '--others', '--exclude-standard']).stdout
    .split(/\r?\n/).filter(Boolean);
  const outside = untracked.filter((f) => !ALLOWED_PUSH_PREFIXES.some((pre) => f.startsWith(pre)));
  if (outside.length > 0) {
    process.stderr.write('拒绝推送：工作区存在四个允许前缀之外的未跟踪文件:\n');
    for (const f of outside.slice(0, 20)) process.stderr.write('  ' + f + '\n');
    process.stderr.write('请清理或加入 .gitignore 后重试。\n');
    process.exit(1);
  }
  runGit(['push']);
  info('已推送。');
  return sha;
}

// ---------------------------------------------------------------- 命令实现

function cmdInit({ model, builder, journal }, flags) {
  assertSiteExists({ forInit: true });
  const name = flags.name;
  if (!name) fail('init 需要 --name <站点名>');
  const slug = model.slugify(flags.slug || 'lotus-muse-site') || 'lotus-muse-site';
  const now = nowIso();
  const site = model.normalizeSite({
    schema_version: 1,
    site_id: hex32(),
    name,
    slug,
    subtitle: flags.subtitle || '',
    sort_direction: flags.sort === 'oldest_first' ? 'oldest_first' : 'newest_first',
    next_sequence: 1,
    base_url: `https://${slug}.pages.dev`,
    created_at: now,
    updated_at: now,
  });
  writeJson(SITE_JSON, site);
  fs.mkdirSync(ENTRIES_DIR, { recursive: true });
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  if (!fs.existsSync(JOURNAL_FILE)) fs.writeFileSync(JOURNAL_FILE, '', 'utf8');
  appendJournal(journal, {
    actor: 'local', action: 'site.update', target: slug,
    commit_sha: null, backup: null, ok: true, note: 'init',
  });
  const content = loadContent(model);
  buildAndWrite({ model, builder }, content);
  commitAndPush({ ...flags }, `lotus.mjs init ${slug}`);
  info(`站点已建立: ${name} (${slug})`);
  info(`base_url: ${site.base_url}`);
}

function resolveImageInputs(images, model, dateStr) {
  const out = [];
  for (let i = 0; i < images.length; i++) {
    const rawIn = images[i];
    const absIn = path.isAbsolute(rawIn) ? rawIn : P(rawIn);
    if (!fs.existsSync(absIn)) fail(`--image 文件不存在: ${rawIn}`);
    const st = fs.statSync(absIn);
    if (!st.isFile()) fail(`--image 不是普通文件: ${rawIn}`);
    if (st.size > MAX_IMAGE_BYTES) {
      fail(`图片超过 5 MiB 上限: ${rawIn} (${st.size} 字节)`);
    }
    const base = path.basename(absIn);
    const relIn = REL(absIn);
    let destRel;
    if (relIn.startsWith('media/')) {
      destRel = relIn; // 已在 media/ 下则直接引用，不重复复制
    } else {
      destRel = `media/${dottedToDir(dateStr)}/${base}`;
      const destAbs = P(...destRel.split('/'));
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.copyFileSync(absIn, destAbs);
    }
    out.push({ id: hex32(), path: destRel, alt: '日志图片', order: i });
  }
  return out;
}

function cmdAddEntry(libs, flags) {
  const { model } = libs;
  const body = readBody(flags);
  if (body == null) fail('add-entry 需要 --body <文字> 或 --body-file <路径>');
  const date = flags.date || todayDotted();
  const images = resolveImageInputs(flags.images || [], model, date);
  const input = {
    date, time_label: flags.time || '', title: flags.title || '',
    body, tags: splitTags(flags.tags), images,
  };
  const check = model.validateEntryInput(input);
  if (!check.ok) dieValidation(check.errors);

  assertSiteExists();
  // 先干跑一遍规范化与往返自检，任何模型层异常都在快照与写盘之前发生。
  const probeSite = model.normalizeSite(readJson(SITE_JSON));
  const seq = probeSite.next_sequence;
  const now = nowIso();
  const entry = model.normalizeEntry({
    schema_version: 1, id: hex32(), sequence: seq,
    date, time_label: input.time_label, title: input.title,
    body, images, tags: input.tags,
    created_at: now, updated_at: now, source: 'local', author: 'lotus',
  }, { sequence: seq });
  assertEntryRoundtrip(model, entry);

  const backup = snapshotContent();
  info(`快照: ${backup}`);
  const content = loadContent(model);
  content.site.next_sequence = seq + 1;
  content.site.updated_at = now;
  writeJson(SITE_JSON, content.site);
  writeJson(path.join(ENTRIES_DIR, model.seqName(seq) + '.json'), entry);
  appendJournal(libs.journal, {
    actor: 'local', action: 'entry.create', target: model.seqName(seq),
    commit_sha: null, backup, ok: true, note: flags.note || null,
  });
  buildAndWrite(libs, loadContent(model));
  const sha = commitAndPush(flags, `lotus.mjs entry.create #${model.seqName(seq)}${flags.note ? ` (${flags.note})` : ''}`);
  info(`新记录 #${model.seqName(seq)} 已写入。${sha ? '提交 ' + sha : '（未提交，加 --commit）'}`);
  info(`线上地址: ${entryUrl(content.site, seq)}`);
}

function entryUrl(site, seq) {
  return (site.base_url || '').replace(/\/+$/, '') + '/entries/' + String(seq).padStart(4, '0') + '.html';
}

function cmdEditEntry(libs, flags, positional) {
  const { model } = libs;
  const seqArg = positional[0];
  if (!seqArg) fail('edit-entry 需要记录序号，如: edit-entry 7');
  const seq = Number(seqArg);
  if (!Number.isInteger(seq) || seq < 1) fail(`序号无效: ${seqArg}`);
  const name = model.seqName(seq);
  const abs = path.join(ENTRIES_DIR, name + '.json');
  if (!fs.existsSync(abs)) fail(`记录 #${name} 不存在。`);
  const raw = readJson(abs);
  const body = readBody(flags);
  const patch = {
    ...raw,
    date: flags.date || raw.date,
    time_label: flags.time != null ? flags.time : (raw.time_label || ''),
    title: flags.title != null ? flags.title : (raw.title || ''),
    body: body != null ? body : raw.body,
    tags: flags.tags != null ? splitTags(flags.tags) : (raw.tags || []),
    updated_at: nowIso(),
    source: raw.source || 'local',
    author: raw.author || 'lotus',
  };
  const check = model.validateEntryInput(patch);
  if (!check.ok) dieValidation(check.errors);

  assertSiteExists();
  const normalizedPatch = model.normalizeEntry(patch, { sequence: seq });
  assertEntryRoundtrip(model, normalizedPatch);
  const backup = snapshotContent();
  info(`快照: ${backup}`);
  writeJson(abs, normalizedPatch);
  const content = loadContent(model);
  content.site.updated_at = nowIso();
  writeJson(SITE_JSON, content.site);
  appendJournal(libs.journal, {
    actor: 'local', action: 'entry.update', target: name,
    commit_sha: null, backup, ok: true, note: flags.note || null,
  });
  buildAndWrite(libs, loadContent(model));
  const sha = commitAndPush(flags, `lotus.mjs entry.update #${name}${flags.note ? ` (${flags.note})` : ''}`);
  info(`记录 #${name} 已更新。${sha ? '提交 ' + sha : '（未提交，加 --commit）'}`);
}

function cmdDeleteEntry(libs, flags, positional) {
  const { model } = libs;
  const seq = Number(positional[0]);
  if (!Number.isInteger(seq) || seq < 1) fail('delete-entry 需要有效序号');
  const name = model.seqName(seq);
  const abs = path.join(ENTRIES_DIR, name + '.json');
  if (!fs.existsSync(abs)) fail(`记录 #${name} 不存在。`);
  assertSiteExists();
  const backup = snapshotContent();
  info(`快照: ${backup}`);
  fs.rmSync(abs);
  // 序号一经分配永不回收：next_sequence 保持不变。
  const content = loadContent(model);
  content.site.updated_at = nowIso();
  writeJson(SITE_JSON, content.site);
  appendJournal(libs.journal, {
    actor: 'local', action: 'entry.delete', target: name,
    commit_sha: null, backup, ok: true, note: flags.note || null,
  });
  buildAndWrite(libs, loadContent(model));
  const sha = commitAndPush(flags, `lotus.mjs entry.delete #${name}${flags.note ? ` (${flags.note})` : ''}`);
  info(`记录 #${name} 已删除（快照可恢复）。${sha ? '提交 ' + sha : ''}`);
}

function cmdAddPage(libs, flags, positional) {
  const { model } = libs;
  const slug = model.slugify(positional[0]);
  if (!slug || slug === 'page' && !positional[0]) fail('add-page 需要网页 slug，如: add-page release-notes');
  const template = flags.template || 'article';
  if (!TEMPLATES.has(template)) fail(`--template 只允许 article/blank/gallery，收到: ${template}`);
  const body = readBody(flags);
  if (body == null) fail('add-page 需要 --body 或 --body-file');
  const nav = flags['no-nav'] ? false : true;
  const input = { slug, title: flags.title || '', subtitle: flags.subtitle || '', body, template, nav };
  const check = model.validatePageInput(input);
  if (!check.ok) dieValidation(check.errors);

  assertSiteExists();
  const abs = path.join(PAGES_DIR, slug + '.json');
  if (fs.existsSync(abs)) fail(`页面 ${slug} 已存在，请用 edit-page。`);
  const now = nowIso();
  const page = model.normalizePage({
    schema_version: 1, id: hex32(), slug,
    title: flags.title || slug, subtitle: flags.subtitle || '',
    body, template, images: [], nav,
    created_at: now, updated_at: now, source: 'local', author: 'lotus',
  });
  assertPageRoundtrip(model, page);
  const backup = snapshotContent();
  info(`快照: ${backup}`);
  writeJson(abs, page);
  const content = loadContent(model);
  content.site.updated_at = now;
  writeJson(SITE_JSON, content.site);
  appendJournal(libs.journal, {
    actor: 'local', action: 'page.create', target: slug,
    commit_sha: null, backup, ok: true, note: flags.note || null,
  });
  buildAndWrite(libs, loadContent(model));
  const sha = commitAndPush(flags, `lotus.mjs page.create ${slug}${flags.note ? ` (${flags.note})` : ''}`);
  info(`页面 ${slug} 已创建。${sha ? '提交 ' + sha : ''}`);
}

function cmdEditPage(libs, flags, positional) {
  const { model } = libs;
  const slug = model.slugify(positional[0]);
  const abs = path.join(PAGES_DIR, slug + '.json');
  if (!fs.existsSync(abs)) fail(`页面 ${slug} 不存在。`);
  const raw = readJson(abs);
  const body = readBody(flags);
  const template = flags.template || raw.template;
  if (!TEMPLATES.has(template)) fail(`--template 无效: ${template}`);
  const patch = {
    ...raw,
    title: flags.title != null ? flags.title : raw.title,
    subtitle: flags.subtitle != null ? flags.subtitle : (raw.subtitle || ''),
    body: body != null ? body : raw.body,
    template,
    nav: flags['no-nav'] ? false : (flags.nav ? true : raw.nav !== false),
    updated_at: nowIso(),
  };
  const check = model.validatePageInput(patch);
  if (!check.ok) dieValidation(check.errors);

  assertSiteExists();
  const normalizedPage = model.normalizePage(patch);
  assertPageRoundtrip(model, normalizedPage);
  const backup = snapshotContent();
  info(`快照: ${backup}`);
  writeJson(abs, normalizedPage);
  const content = loadContent(model);
  content.site.updated_at = nowIso();
  writeJson(SITE_JSON, content.site);
  appendJournal(libs.journal, {
    actor: 'local', action: 'page.update', target: slug,
    commit_sha: null, backup, ok: true, note: flags.note || null,
  });
  buildAndWrite(libs, loadContent(model));
  const sha = commitAndPush(flags, `lotus.mjs page.update ${slug}${flags.note ? ` (${flags.note})` : ''}`);
  info(`页面 ${slug} 已更新。${sha ? '提交 ' + sha : ''}`);
}

function cmdDeletePage(libs, flags, positional) {
  const { model } = libs;
  const slug = model.slugify(positional[0]);
  const abs = path.join(PAGES_DIR, slug + '.json');
  if (!fs.existsSync(abs)) fail(`页面 ${slug} 不存在。`);
  assertSiteExists();
  const backup = snapshotContent();
  info(`快照: ${backup}`);
  fs.rmSync(abs);
  const content = loadContent(model);
  content.site.updated_at = nowIso();
  writeJson(SITE_JSON, content.site);
  appendJournal(libs.journal, {
    actor: 'local', action: 'page.delete', target: slug,
    commit_sha: null, backup, ok: true, note: flags.note || null,
  });
  buildAndWrite(libs, loadContent(model));
  const sha = commitAndPush(flags, `lotus.mjs page.delete ${slug}${flags.note ? ` (${flags.note})` : ''}`);
  info(`页面 ${slug} 已删除（快照可恢复）。${sha ? '提交 ' + sha : ''}`);
}

function cmdRepublish(libs, flags) {
  assertSiteExists();
  const backup = snapshotContent();
  info(`快照: ${backup}`);
  const content = loadContent(libs.model);
  content.site.updated_at = nowIso();
  writeJson(SITE_JSON, content.site);
  appendJournal(libs.journal, {
    actor: 'local', action: 'republish', target: content.site.slug,
    commit_sha: null, backup, ok: true, note: flags.note || null,
  });
  buildAndWrite(libs, loadContent(libs.model));
  flags._republish = true;
  const sha = commitAndPush(flags, `lotus.mjs republish${flags.note ? ` (${flags.note})` : ''}`);
  info(sha ? `已产生提交 ${sha}，Pages 将随之重新部署。` : 'site/ 已重建（未提交）。');
}

function cmdRestore(libs, flags) {
  const { model } = libs;
  const backupArg = flags.backup;
  if (!backupArg) fail('restore 需要 --backup backups/<快照目录名>');
  const relBackup = String(backupArg).replace(/\\/g, '/').replace(/\/+$/, '');
  if (!relBackup.startsWith('backups/')) fail('--backup 必须是 backups/ 下的快照目录。');
  try { model.assertSafeRelPath(relBackup); } catch (err) { fail(`快照路径不安全: ${err.message}`); }
  const srcAbs = P(...relBackup.split('/'));
  if (!fs.existsSync(srcAbs) || !fs.statSync(srcAbs).isDirectory()) fail(`快照不存在: ${relBackup}`);
  assertSiteExists();

  const currentBackup = snapshotContent(); // 恢复前也先快照当前状态，恢复本身可再被恢复
  info(`当前状态快照: ${currentBackup}`);
  fs.rmSync(CONTENT_DIR, { recursive: true, force: true });
  fs.cpSync(srcAbs, CONTENT_DIR, { recursive: true });
  // journal 追加式：恢复来的 journal 之后补一条 restore 事件。
  appendJournal(libs.journal, {
    actor: 'local', action: 'restore', target: relBackup,
    commit_sha: null, backup: currentBackup, ok: true, note: flags.note || null,
  });
  buildAndWrite(libs, loadContent(model));
  const sha = commitAndPush(flags, `lotus.mjs restore ${relBackup}${flags.note ? ` (${flags.note})` : ''}`);
  info(`已从 ${relBackup} 恢复 content/。${sha ? '提交 ' + sha : ''}`);
}

function cmdStatus(libs) {
  const { model } = libs;
  if (!fs.existsSync(SITE_JSON)) fail('站点尚未初始化（缺 content/site.json）。');
  const content = loadContent(model);
  info(`站点: ${content.site.name} (${content.site.slug})`);
  info(`副标题: ${content.site.subtitle || '(无)'}`);
  info(`排序: ${content.site.sort_direction}`);
  info(`base_url: ${content.site.base_url}`);
  info(`next_sequence: ${content.site.next_sequence}`);
  info(`记录: ${content.entries.length} 条`);
  for (const e of content.entries) {
    info(`  #${model.seqName(e.sequence)}  ${e.date}${e.time_label ? ' ' + e.time_label : ''}  ${e.title || String(e.body).slice(0, 24)}`);
  }
  info(`页面: ${content.pages.length} 个`);
  for (const pg of content.pages) info(`  ${pg.slug}  ${pg.title}`);
  const lines = fs.existsSync(JOURNAL_FILE)
    ? fs.readFileSync(JOURNAL_FILE, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  info(`journal: ${lines.length} 条，最近 ${Math.min(5, lines.length)} 条如下`);
  for (const l of lines.slice(-5)) {
    try {
      const ev = JSON.parse(l);
      info(`  ${ev.ts}  ${ev.actor}  ${ev.action}  ${ev.target}`);
    } catch { info('  (无法解析的一行: ' + l.slice(0, 60) + ')'); }
  }
  const snaps = fs.existsSync(BACKUPS_DIR) ? fs.readdirSync(BACKUPS_DIR).filter((d) => !d.includes('scratch')) : [];
  info(`快照: ${snaps.length} 份`);
  info(`site/index.html: ${fs.existsSync(path.join(SITE_OUT_DIR, 'index.html')) ? '已构建' : '未构建（运行 build）'}`);
}

function cmdBuild(libs) {
  assertSiteExists();
  const content = loadContent(libs.model);
  buildAndWrite(libs, content);
}

// ---------------------------------------------------------------- main

async function main() {
  const { cmd, flags, images, positional } = parseCli(process.argv.slice(2));
  if (!cmd || flags.help || cmd === 'help') { info(HELP); process.exit(cmd ? 0 : 1); }

  const libs = await loadLibs();
  libs.flags = flags;

  switch (cmd) {
    case 'init': return cmdInit(libs, flags);
    case 'add-entry': flags.images = images; return cmdAddEntry(libs, flags);
    case 'edit-entry': return cmdEditEntry(libs, flags, positional);
    case 'delete-entry':
    case 'del-entry': return cmdDeleteEntry(libs, flags, positional);
    case 'add-page': return cmdAddPage(libs, flags, positional);
    case 'edit-page': return cmdEditPage(libs, flags, positional);
    case 'delete-page': return cmdDeletePage(libs, flags, positional);
    case 'republish': return cmdRepublish(libs, flags);
    case 'restore': return cmdRestore(libs, flags);
    case 'status': return cmdStatus(libs);
    case 'build':
    case 'rebuild': return cmdBuild(libs);
    default:
      process.stderr.write(`未知命令: ${cmd}\n\n`);
      info(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  if (err && err.name === 'ModelError') fail(err.message);
  fail(err && err.stack ? err.stack : String(err));
});
