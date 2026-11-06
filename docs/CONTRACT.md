# CONTRACT — lotus-muse-site

本文件是这个仓库的唯一接口真源。任何实现（站点构建、Worker API、本地写入器、
Muse 说明书、测试）都必须逐字遵守这里的路径、字段名和函数签名。改契约先改本文件。

## 0. 目标

把 lotus 个人站点的日常维护（加一条记录 / 上一个新网页 / 改一篇 / 删一篇 / 重新发布）
交给 Meta Muse 完成。Muse 侧只有一个 HTTPS JSON API + 单个 Bearer Token 可用
（依据 Muse 自有文档 `~/docs/connectors.md:148`：无 connector 的服务只能走
custom connector `credentials.request_api_access`，且"多把密钥/请求签名"的提供方会被拒绝）。
因此所有写操作经 Worker API，由 Worker 用**单仓库细粒度 PAT**提交到本仓库，
并由 Worker 用**只限 Pages 上传的 API Token**把构建产物直传 Cloudflare Pages
（项目 `lotus-muse-site`，production branch `main`，直传免 Git 绑定，
因此不依赖 Cloudflare 的 GitHub App 是否装在本仓库上；这与本机既有工具
`LotusSiteManager/src/LotusSiteManager.Core/CloudflareService.cs:77` 用的
`wrangler pages deploy` 同一部署形态）。Worker 侧内部有几把凭据与 Muse 无关：
Muse 只持有自己那一个 Bearer Token，这才是 Muse 自定义连接器能吃下的形状。
原 `lotussblog` 等既有仓库不被触碰。

部署顺序的意义：先提交 GitHub（可追溯、可回滚），成功后才直传 Pages；
GitHub 提交失败则整个写操作返回失败且不部署，避免站点与仓库漂移。

## 1. 目录布局（仓库内）

```
content/site.json                 站点清单（唯一）
content/entries/<seq>.json        一条日志记录，<seq> = 4 位零填充序号，如 0001.json
content/pages/<slug>.json         一个独立网页
content/journal.jsonl             操作流水，一行一个 JSON 事件（追加写）
backups/<iso-ts>/…                每次写操作前的 content/ 全量快照（文本）
site/                             构建产物 = Cloudflare Pages 输出目录（直接提交进仓库，Pages 免构建命令）
  index.html                      首页：清单 + 全部记录倒序/正序
  entries/<seq>.html              单条记录页
  pages/<slug>.html               独立网页
  assets/site.css                 全站样式（唯一 css）
  assets/…                        图片等媒体
media/                            图片源文件（提交进仓库，构建时复制到 site/assets/media/）
lib/                              纯函数实现，Node 与 Worker 共用，无 IO、无环境依赖
  model.mjs                       校验 + 规范化
  template.mjs                    HTML 渲染
  build.mjs                       content -> site 产物（内存）
  journal.mjs                     事件结构
  http.mjs                        路由表与响应封装（Worker 使用）
api/                              Cloudflare Worker
  src/index.js                    入口
  wrangler.toml                   名字 lotus-muse-api
scripts/                          本机工具（不依赖 Muse）
  lotus.mjs                       CLI：add-entry/edit-entry/del-entry/add-page/rebuild/restore/status
  live-verify.mjs                 取线上 URL 断言内容真的出现了
tests/                            node --test
docs/                             ASSESSMENT / ARCHITECTURE / SECURITY / RUNBOOK
muse/                             交给 Muse 的那一套（SKILL.md / manifest.yaml / 提示词 / 接入步骤）
```

## 2. 数据结构

### content/site.json
```json
{
  "schema_version": 1,
  "site_id": "<hex32>",
  "name": "string",
  "slug": "lotus-muse-site",
  "subtitle": "string",
  "sort_direction": "newest_first | oldest_first",
  "next_sequence": 1,
  "base_url": "https://lotus-muse-site.pages.dev",
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

### content/entries/<seq>.json
```json
{
  "schema_version": 1,
  "id": "<hex32>",
  "sequence": 1,
  "date": "2026.11.6",
  "time_label": "可选，如 晚上",
  "title": "可选，短标题",
  "body": "正文。段落用 \\n\\n 分隔，不做富文本。",
  "images": [{"id": "<hex32>", "path": "media/2026-11-06/xxx.png", "alt": "日志图片", "order": 0}],
  "tags": ["可选"],
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "source": "muse | local",
  "author": "lotus | lotus-muse-bot"
}
```
不变式：`sequence` 一经分配永不改变；删除不回收序号；`next_sequence` 只增。

### content/pages/<slug>.json
```json
{
  "schema_version": 1,
  "id": "<hex32>",
  "slug": "release-notes",
  "title": "页面标题",
  "subtitle": "可选",
  "body": "段落文本",
  "template": "article | blank | gallery",
  "images": [],
  "nav": true,
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "source": "muse | local",
  "author": "lotus | lotus-muse-bot"
}
```

### content/journal.jsonl 一行
```json
{"ts":"ISO8601","actor":"muse|local","action":"entry.create|entry.update|entry.delete|page.create|page.update|page.delete|site.update|republish|restore","target":"0007|slug","commit_sha":"…","backup":"backups/2026-11-06T07-00-00Z","ok":true,"note":"…"}
```

## 3. lib 函数签名（纯函数，禁止 process/fetch/env）

```js
// lib/model.mjs
normalizeSite(raw)            -> site            // 抛 ModelError
normalizeEntry(raw, {sequence}) -> entry
normalizePage(raw)            -> page
validateEntryInput(obj)       -> {ok, errors:[{field, message}]}
validatePageInput(obj)        -> {ok, errors}
seqName(sequence)             -> "0007"
slugify(input)                -> "a-b-c"          // 只允许 [a-z0-9-]，空则 "page"
assertSafeRelPath(p)          -> p | throw ModelError   // 拒 .. / 绝对路径 / 盘符 / 前导点

// lib/template.mjs
renderCss()                   -> string
renderIndex({site, entries})  -> string  // HTML，不含样例内容
renderEntry({site, entry, prev, next}) -> string
renderPage({site, page})      -> string
escapeHtml(s)                 -> string
parasToHtml(body)             -> string  // \n\n 分段，正文转义后 <p>

// lib/build.mjs
buildSite({site, entries, pages, mediaPaths}) -> { files: {"site/index.html": "...", ...}, counts }
//   files 的键一律以 "site/" 开头；同输入必同输出（byte 级确定，无时间戳）

// lib/journal.mjs
makeEvent(partial)            -> event  // 补齐 ts/schema 默认
```

## 4. HTTP API

Base：`https://lotus-muse-api.smartlotus1130.workers.dev`
读接口公开；写接口需 `Authorization: Bearer <MUSE_API_TOKEN>`。
一切响应 `Content-Type: application/json`，形状恒为 `{ "ok": boolean, ... }`；
失败为 `{"ok":false,"error":{"code":"…","message":"…"}}`。

| Method | Path | Auth | 说明 |
|---|---|---|---|
| GET | `/health` | 否 | `{ok,mode:"live"\|"dry-run",repo,base_url,counts}` |
| GET | `/capabilities` | 是 | `{ok,scopes:["read","entry.write","page.write","site.republish","site.restore"],token_valid:true,identity:"muse"}` — Muse 以此判断实际权限，不得猜测；`/health` 通过不代表已认证或已写入 |
| GET | `/site` | 否 | 站点清单 + 统计 |
| GET | `/entries` | 否 | 列表（不含 body） |
| GET | `/entries/:seq` | 否 | 单条全文 |
| GET | `/pages` | 否 | 页面列表 |
| GET | `/journal?limit=20` | 否 | 最近操作 |
| POST | `/entries` | 是 | 加一条记录 |
| PUT | `/entries/:seq` | 是 | 改一条记录（全量替换可改字段） |
| DELETE | `/entries/:seq` | 是 | 删一条记录 |
| POST | `/pages` | 是 | 部署一个新网页 |
| PUT | `/pages/:slug` | 是 | 改一个网页 |
| DELETE | `/pages/:slug` | 是 | 删一个网页 |
| POST | `/actions/republish` | 是 | 内容不变，重建并提交一次以触发 Pages 重新部署 |
| POST | `/actions/restore` | 是 | `{backup:"backups/…"}` 从快照整树恢复 |
| POST | `/actions/rollback-entry` | 是 | `{sequence:7, backup:"…"}` 只回滚一条 |

写请求体（POST /entries）：
```json
{"date":"2026.11.6","time_label":"","title":"","body":"…","tags":[],
 "images":[{"path":"media/x.png","base64":"…","alt":"…"}],
 "note":"给 journal 的说明","expect_sequence":7}
```
`images[].path` 指仓库内已有文件；`base64` 表示要新建的媒体，写入 `media/<date>/<basename>`，
单文件上限 5 MiB，总量上限 10 MiB。

写响应：
```json
{"ok":true,"mode":"live","entry":{…},"commit_sha":"…","commit_url":"…",
 "changed_files":["content/entries/0007.json","site/index.html",…],
 "journal":{…},"deploy":{"hint":"已直传 Pages","url":"https://…/entries/0007.html"}}
```
dry-run 模式（Worker 未配 GITHUB_TOKEN 时）：不写仓库，返回同一形状但
`mode:"dry-run"`、`commit_sha:null`、多一个 `planned_files:[{path,bytes}]`
（只报路径与字节数，不把整站产物正文塞进一次响应；要正文就再发一次 `GET`）。

错误码（`error.code`）：
`unauthorized`(401) `forbidden`(403) `not_found`(404) `method_not_allowed`(405)
`invalid_input`(400，带 `details.errors`) `unsafe_path`(400) `too_large`(413)
`conflict_sequence`(409，`expect_sequence` 与实际不符) `github_unauthenticated`(503)
`github_failed`(502) `internal`(500)

并发/幂等：Contents API 的 `sha` 取自刚读到的 tree；冲突时返回 `conflict_sequence`/`github_failed`
并要求调用方重试一次。同一 `idempotency_key`（可选头 `Idempotency-Key`）在 60s 内
返回上次结果（Worker MemoryCache 简易实现即可，文档要写明是尽力而为）。

## 5. 安全红线

1. Worker 只用**单仓库 fine-grained PAT**：Repository access = Only select repositories
   选中 `lotus-muse-site`；Permissions 仅 `contents: read and write`。不给 admin、不给
   仓库列表外权限、不给用户级 token。
2. 绝不使用本机 `gh` 的 `gho_…`（scopes 含 `repo`＝账号全部仓库可写）作为 Muse 通道。
3. 写路径只允许 `content/…`、`site/…`、`media/…`、`backups/…` 四个前缀；其余一律 `unsafe_path`。
4. 不做 force push，不改历史，不删 `backups/`。
5. Token 比较用定长摘要比对，未配 token 时写接口一律 401（禁止默认放行）。
6. Worker 不回显任何 secret；日志只记 action 与结果码。

## 6. 验收判据（必须真跑）

- `npm test` 全绿：model / template / build 确定性 / journal / http 路由 / 鉴权 / 路径穿越 /
  序号不变式 / restore 往返 / base64 落盘路径。
- 构建确定性：同一 content 连跑两次 `buildSite` 得到 byte 相同结果。
- 本机能不出门发布：`node scripts/lotus.mjs add-entry …` 产出可提交的 site/ 且 git 提交成功。
- 线上真实验证：`node scripts/live-verify.mjs` 取 Pages 线上页，断言本次 marker 字符串出现
  （不是断言"部署返回 200"）。
- Worker 侧：`/health` 上线；未配 PAT 时写接口返回 `mode:"dry-run"` 且 planned_files 完整；
  配了 PAT 后一次真实 POST 能在 GitHub 看到 `lotus-muse-bot` 的提交并触发 Pages 部署。
