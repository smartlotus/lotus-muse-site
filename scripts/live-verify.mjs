#!/usr/bin/env node
// scripts/live-verify.mjs: 线上真实验证，取回页面字节，断言本次改动真的出现了。
// 依据 docs/CONTRACT.md 第 6 节：验收标准是"线上页能看到 marker"，不是"接口返回 200"。
// 本地同样可用：先 npx --yes serve -s site -l 5055，再 --base http://127.0.0.1:5055 验证。

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// 禁止残留的样例词。为避免本脚本自身被全仓库扫描误伤，这些词以拼接方式构造。
const FORBIDDEN_WORDS = ['TO' + 'DO', 'lo' + 'rem', 'place' + 'hold' + 'er', '[' + 'insert'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--base') out.base = argv[++i];
    else if (t === '--expect') out.expect = argv[++i];
    else if (t === '--entry') out.entry = argv[++i];
    else if (t === '--page') out.page = argv[++i];
    else if (t === '--timeout') out.timeout = Number(argv[++i]);
    else if (t === '--help' || t === '-h') { usage(); process.exit(0); }
    else { process.stderr.write(`未知参数: ${t}\n`); usage(); process.exit(1); }
  }
  return out;
}

function usage() {
  process.stdout.write(
    '用法: node scripts/live-verify.mjs [--expect <本次标记>] [--base <url>] [--entry <seq>] [--page <slug>]\n' +
    '缺省 base 取 content/site.json 的 base_url；--expect 必填。\n'
  );
}

function readJsonSafe(abs) {
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; }
}

function seqName(seq) { return String(seq).padStart(4, '0'); }

function escapeForHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function containsText(html, text) {
  if (!text) return true;
  return html.includes(text) || html.includes(escapeForHtml(text));
}

function fetchDoc(base, relPath, timeoutMs) {
  // 用 node:http 而不是全局 fetch：undici 的 keep-alive socket 会让 Windows 上的
  // process.exit 触发 libuv 断言；Connection: close 保证退出前所有句柄都已关闭。
  const url = new URL(base.replace(/\/+$/, '') + relPath);
  return new Promise((resolve) => {
    const request = (target, depth) => {
      const lib = target.protocol === 'https:' ? https : http;
      const req = lib.get(target, { headers: { connection: 'close' }, timeout: timeoutMs }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && depth < 3) {
          res.resume();
          request(new URL(res.headers.location, target), depth + 1);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          url: target.toString(),
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      req.on('timeout', () => { req.destroy(new Error(`超时 ${timeoutMs}ms`)); });
      req.on('error', (err) => resolve({ url: target.toString(), status: 0, body: '', error: err.message }));
    };
    request(url, 0);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.expect) {
    process.stderr.write('必须提供 --expect <substring>，即本次改动里独有、线上原本没有的字符串。\n');
    usage();
    process.exit(1);
  }
  let base = args.base;
  if (!base) {
    const site = readJsonSafe(path.join(ROOT, 'content', 'site.json'));
    if (site && site.base_url) base = site.base_url;
  }
  if (!base) {
    process.stderr.write('缺少 --base，且 content/site.json 不存在或没有 base_url。\n');
    process.exit(1);
  }
  base = base.replace(/\/+$/, '');
  const timeoutMs = Number.isFinite(args.timeout) && args.timeout > 0 ? args.timeout : 20000;

  const targets = [{ rel: '/', label: '首页 /' }];
  let entryMeta = null;
  if (args.entry) {
    const seq = Number(args.entry);
    if (!Number.isInteger(seq) || seq < 1) {
      process.stderr.write('--entry 需要正整数序号\n');
      process.exit(1);
    }
    targets.push({ rel: `/entries/${seqName(seq)}.html`, label: `记录页 /entries/${seqName(seq)}.html` });
    entryMeta = readJsonSafe(path.join(ROOT, 'content', 'entries', seqName(seq) + '.json'));
  }
  let pageSlug = args.page;
  if (!pageSlug) {
    const dir = path.join(ROOT, 'content', 'pages');
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
      if (files.length > 0) pageSlug = files[0].replace(/\.json$/, '');
    }
  }
  if (pageSlug) targets.push({ rel: `/pages/${pageSlug}.html`, label: `页面 /pages/${pageSlug}.html` });

  const rows = [];
  const results = [];
  for (const t of targets) {
    const doc = await fetchDoc(base, t.rel, timeoutMs);
    results.push({ ...t, doc });
    rows.push([`GET ${t.rel} 返回 200`, doc.status === 200, doc.error ? `请求失败: ${doc.error}` : `状态码 ${doc.status}`]);
    if (doc.status === 200) {
      const found = FORBIDDEN_WORDS.filter((w) => doc.body.toLowerCase().includes(w.toLowerCase()));
      rows.push([
        `${t.label}: 无残留样例词`,
        found.length === 0,
        found.length === 0 ? '' : `发现: ${found.join(', ')}`,
      ]);
    }
  }

  const okBodies = results.filter((r) => r.doc.status === 200).map((r) => r.doc.body);
  rows.push([
    `--expect 标记出现在至少一个已取回页面`,
    okBodies.some((b) => containsText(b, args.expect)),
    okBodies.length === 0 ? '没有任何页面取回成功' : `标记: ${args.expect}`,
  ]);
  if (args.entry) {
    const entryDoc = results.find((r) => r.rel.startsWith('/entries/'));
    if (entryDoc && entryDoc.doc.status === 200) {
      const b = entryDoc.doc.body;
      rows.push([`记录页包含 --expect 标记`, containsText(b, args.expect), '']);
      rows.push([`记录页包含编号徽标 #${seqName(Number(args.entry))}`, containsText(b, '#' + seqName(Number(args.entry))), '']);
      if (entryMeta) {
        if (entryMeta.title) rows.push([`记录页渲染标题: ${entryMeta.title}`, containsText(b, entryMeta.title), '']);
        rows.push([`记录页渲染日期: ${entryMeta.date}`, containsText(b, entryMeta.date), '']);
        if (entryMeta.time_label) rows.push([`记录页渲染时间标签: ${entryMeta.time_label}`, containsText(b, entryMeta.time_label), '']);
      } else {
        rows.push([`本地 content/entries/${seqName(Number(args.entry))}.json 可用于断言`, false, '缺少源文件，跳过标题/日期断言']);
      }
    }
  }

  const width = Math.max(...rows.map((r) => [...r[0]].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0)));
  process.stdout.write('\n检查项'.padEnd(width + 2) + '结果\n');
  process.stdout.write('-'.repeat(width + 12) + '\n');
  let failed = 0;
  for (const [label, pass, detail] of rows) {
    if (!pass) failed++;
    const pad = width + 2 - [...label].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);
    process.stdout.write(label + ' '.repeat(Math.max(1, pad)) + (pass ? 'PASS' : 'FAIL') + (detail ? `  (${detail})` : '') + '\n');
  }
  process.stdout.write('-'.repeat(width + 12) + '\n');
  process.stdout.write(`共 ${rows.length} 项，失败 ${failed} 项。目标: ${base}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`异常: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
