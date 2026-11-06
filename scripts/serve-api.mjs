#!/usr/bin/env node
// scripts/serve-api.mjs: 把 api/src/index.js 的 Worker fetch handler 原样跑在 node:http 上。
// 目的：在本地用 curl 验证与 Cloudflare Worker 完全相同的代码路径，不部署也能测。
// env 来源：.dev.vars 打底，process.env 显式设置的同名变量可覆盖它，
// 方便用一次性测试 token 演练而不必改动 .dev.vars。
// 本脚本永不打印任何 secret 的值，只打印是否已配置。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function parseArgs(argv) {
  const out = { port: 8787, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--port') out.port = Number(argv[++i]);
    else if (t.startsWith('--port=')) out.port = Number(t.slice(7));
    else if (t === '--dry-run') out.dryRun = true;
    else if (t === '--help' || t === '-h') {
      process.stdout.write('用法: node scripts/serve-api.mjs [--port 8787] [--dry-run]\n');
      process.exit(0);
    } else {
      process.stderr.write(`未知参数: ${t}\n`);
      process.exit(1);
    }
  }
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) {
    process.stderr.write('--port 无效\n');
    process.exit(1);
  }
  return out;
}

function loadDevVars() {
  const env = {};
  const file = path.join(ROOT, '.dev.vars');
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) env[key] = val;
  }
  return env;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let handler;
  const entryPath = path.join(ROOT, 'api', 'src', 'index.js');
  if (!fs.existsSync(entryPath)) {
    process.stderr.write('缺少 api/src/index.js（由另一位协作者按 docs/CONTRACT.md 第 4 节实现），本地 API 服务无法启动。\n');
    process.exit(1);
  }
  try {
    const mod = await import(pathToFileURL(entryPath).href);
    handler = (mod.default && typeof mod.default.fetch === 'function' && mod.default.fetch)
      || (typeof mod.fetch === 'function' && mod.fetch)
      || (typeof mod.request === 'function' && mod.request);
  } catch (err) {
    process.stderr.write(`导入 api/src/index.js 失败: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
  if (typeof handler !== 'function') {
    process.stderr.write('api/src/index.js 没有导出 fetch(request, env, ctx) handler，无法适配。\n');
    process.exit(1);
  }

  const devVars = loadDevVars();
  const env = { ...devVars, ...process.env };
  if (args.dryRun) {
    // --dry-run 用于强制演练：摘掉 GitHub 写入凭据，Worker 依契约 §4 回落到 dry-run 模式，
    // 但保留 MUSE_API_TOKEN，鉴权路径仍可被真实测试。
    delete env.GITHUB_TOKEN;
    delete env.GITHUB_PAT;
  }

  const hasGithubToken = typeof env.GITHUB_TOKEN === 'string' && env.GITHUB_TOKEN.length > 0;
  const mode = hasGithubToken ? 'live' : 'dry-run';

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      respond(req, Buffer.concat(chunks), res).catch((err) => {
        process.stderr.write(`请求处理异常: ${err && err.stack ? err.stack : err}\n`);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: { code: 'internal', message: 'local adapter failure' } }));
        }
      });
    });
  });

  async function respond(req, body, res) {
    const url = new URL(req.url, `http://127.0.0.1:${args.port}`);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) for (const item of v) headers.append(k, item);
      else if (v != null) headers.set(k, v);
    }
    const method = req.method.toUpperCase();
    const init = { method, headers };
    if (method !== 'GET' && method !== 'HEAD') init.body = body.length > 0 ? body : undefined;
    const request = new Request(url.toString(), init);

    const ctx = { waitUntil() {}, passThroughOnException() {} };
    let response = await handler(request, env, ctx);
    // 防御：api/src/index.js 的写路由目前返回 {response: Response} 包装对象。
    // 真正的 Cloudflare Worker 会把它当成非法返回值，这偏离已在验收报告中反馈。
    // 这里解开包装以便本地继续演练，对方修复后此分支自然失效。
    if (response && typeof response.arrayBuffer !== 'function'
      && response.response && typeof response.response.arrayBuffer === 'function') {
      response = response.response;
    }
    const buf = Buffer.from(await response.arrayBuffer());
    const outHeaders = {};
    response.headers.forEach((v, k) => { outHeaders[k] = v; });
    res.writeHead(response.status, outHeaders);
    res.end(buf);
    process.stdout.write(`${method} ${url.pathname} -> ${response.status}\n`);
  }

  server.listen(args.port, '127.0.0.1', () => {
    process.stdout.write(`serve-api: http://127.0.0.1:${args.port}\n`);
    process.stdout.write(`模式: ${mode} (GITHUB_TOKEN ${hasGithubToken ? '已配置' : '未配置'}; .dev.vars ${fs.existsSync(path.join(ROOT, '.dev.vars')) ? '已加载' : '不存在'})\n`);
    if (!hasGithubToken && !args.dryRun) {
      process.stdout.write('提示: 写接口将返回 mode:"dry-run" 与 planned_files，不触碰 GitHub。这符合契约第 4 节。\n');
    }
  });
}

main().catch((err) => {
  process.stderr.write(`启动失败: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
