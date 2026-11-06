# lotus-muse-site

lotus 的个人站点仓库：内容就是 `content/` 里的 JSON 数据，构建出 `site/`
静态产物，由 Cloudflare Pages 发布。日常维护（加记录、上网页、改一篇、
删一篇、重新发布、回滚）打算直接对 Meta Muse 说一句话就完成；Muse 通过
一个 HTTPS JSON API（Cloudflare Worker）写入，Worker 用一把只授权本仓库的
细粒度 GitHub PAT 提交，全程可回滚。

这是全新仓库，与旧的 `lotussblog` 等仓库无关，旧仓库不会被触碰。
它替代此前用过的 Windows 图形工具 LotusSiteManager（同一件事的桌面版做法）：
固定模板、稳定编号、发布前快照、两步式发布这些规则原样继承；
区别是维护入口从"打开程序点按钮"变成"对 Muse 说话"或一条命令，
而发布从"本机 wrangler 直传"变成"GitHub 提交驱动 Pages 构建 + Worker
必要时直传"。接口与验收的唯一真源是 [`docs/CONTRACT.md`](docs/CONTRACT.md)。

## 5 分钟上手（纯本地，不需要任何云账号）

```powershell
npm install            # 当前零第三方依赖，装个心安
node scripts/lotus.mjs init --name "lotus的小站" --slug lotus-muse-site --subtitle "记录, 不是文章"
node scripts/lotus.mjs add-entry --title "第一次" --body "这条是本地加的" --tags 起点
node scripts/lotus.mjs build
npx --yes serve -s site -l 5055
# 另开一个终端：
node scripts/live-verify.mjs --base http://127.0.0.1:5055 --expect "这条是本地加的" --entry 1
npm test
```

要接 Muse / 上线，看 `docs/RUNBOOK.md`（人工部署一次）和
`muse/CONNECT-SETUP.md`（连接一次），之后日常只需对 Muse 说
`muse/PROMPTS.md` 里那样的话。

## 目录速览

| 路径 | 是什么 |
|---|---|
| `docs/CONTRACT.md` | 接口契约唯一真源（路径、字段、函数签名、HTTP 表、验收判据） |
| `docs/ARCHITECTURE.md` | 一图流：Muse 到线上站点各段住哪里、为什么特权只在 Worker |
| `docs/SECURITY.md` | 威胁模型、各 token 的爆炸半径、轮换步骤 |
| `docs/RUNBOOK.md` | 首次部署与日常排障 |
| `content/` | 站点清单、每条记录、每个页面、只增流水 journal.jsonl |
| `site/` | 构建产物，Pages 的输出目录 |
| `lib/` | 纯函数（校验/模板/构建/流水/路由表），Node 与 Worker 共用 |
| `api/` | Cloudflare Worker 入口与 wrangler 配置 |
| `scripts/lotus.mjs` | 本机 CLI，不依赖云凭据即可完成同等维护 |
| `scripts/serve-api.mjs` | 本地跑 Worker 同一份代码，curl 可验 |
| `scripts/live-verify.mjs` | 抓线上字节断言"改动真的出现了" |
| `muse/` | 交给 Muse 的全套：SKILL、manifest、连接步骤、八条话术、能力边界说明 |
| `tests/` | `node --test` |

## 当前状态

<!-- OWNER-VERIFY -->
核对时间 2026-11-06（UTC）。逐条判据与复算方式在 `docs/EVIDENCE.md`，这里只给结论。

已在真机跑通：

- `npm test`：89/89 全绿。测试不是摆设——它在本轮抓出 4 个真缺陷（带 `:param` 的路由整体 404、
  日期正则缺捕获组导致日期被写成 `undefined.NaN.NaN`、`gh.put` 可盲目覆盖、产物越界前缀）。
- 构建确定性：同一份 `content/` 两次构建产物字节相同。
- 本机命令行闭环：`add-entry` 真实写入 `#0003`（快照 → 接续序号 → 重建 → 提交 `062e099`），
  并完成回滚往返（`6d0e996` 退回到 0003 之前 → `9abfd66` 恢复回来），两次都用首页命中数验证。
- Pages 已上线：`https://lotus-muse-site.pages.dev/` 返回 200，首页含站点名与记录标题，
  产物里零脏日期。
- Worker 已上线：`https://lotus-muse-api.smartlotus1130.workers.dev`，
  并且**用 Muse 会被允许的那一种调用形状实测过**——无 token 的写请求 401，
  带 token 的 `POST /entries` 返回 200 且 `planned_files` 16 项全部落在允许前缀内。
  原始响应存在 `docs/evidence-live-post.json`。
- 代码与内容已推送，远端 SHA 与本地相等（`9abfd66…`）。

尚未跑通，缺的都是授权而不是能力：

- Worker 的真实 GitHub 提交（写仓库 + 部署）需要一把**只限本仓库、只有 Contents 读写**的
  fine-grained PAT，GitHub 没有任何 API 能替人铸造它。
- Muse 侧的连接需要你在它的安全密钥入口填 `MUSE_API_TOKEN`（值在 `.dev.vars`，不进仓库也不进聊天）。
- 线上版本落后于仓库：Worker 是 `7e04985a`（其后仓库又有 3 处修复），Pages 是 2 条记录而仓库已是 3 条。
  本机 wrangler 的 OAuth token 已在今天 08:01Z 过期，追平需要一次 `npx wrangler login`。
  补做这三步的顺位与命令在 `docs/RUNBOOK.md`。

原仓库零改动：`lotussblog`、`lotussmindstream`、`LotusSiteManager` 以及本地三份博客副本本轮只被读取过。
<!-- /OWNER-VERIFY -->
