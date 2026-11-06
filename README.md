# lotus-muse-site

lotus 的个人站点仓库：内容就是 `content/` 里的 JSON 数据，构建出 `site/`
静态产物，**push 到 main 即自动部署到 GitHub Pages**（公开地址
<https://smartlotus.github.io/lotus-muse-site/>）。日常维护（加记录、上网页、
改一篇、删一篇、重新发布、回滚）打算直接对 Meta Muse 说一句话就完成。
Muse 有两条等价通道：**模式 B**——在它自己的云电脑里克隆本仓库、只跑
`scripts/lotus.mjs`（推荐，见 `muse/MODE-B-SETUP.md`）；或**模式 A**——调一个
HTTPS JSON API（Cloudflare Worker，可选），Worker 用一把只授权本仓库的
细粒度 GitHub PAT 提交，全程可回滚。

这是全新仓库，与旧的 `lotussblog` 等仓库无关，旧仓库不会被触碰。
它替代此前用过的 Windows 图形工具 LotusSiteManager（同一件事的桌面版做法）：
固定模板、稳定编号、发布前快照、两步式发布这些规则原样继承；
区别是维护入口从"打开程序点按钮"变成"对 Muse 说话"或一条命令，
而发布从"本机 wrangler 直传"变成"git push 即部署"（GitHub Actions 构建
`site/` 并发到 GitHub Pages）。接口与验收的唯一真源是 [`docs/CONTRACT.md`](docs/CONTRACT.md)。

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

要接 Muse，**先看 `muse/MODE-B-SETUP.md`（推荐通道：Muse 云电脑直接跑 CLI，
一次凭据注入就完事）**；或走可选的 API 通道 `muse/CONNECT-SETUP.md`（连接一次）。
部署已自动化（push 即部署），日常只需对 Muse 说 `muse/PROMPTS.md` 里那样的话。

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
| `muse/` | 交给 Muse 的全套：模式 B 手册（推荐）、SKILL、manifest、连接步骤、八条话术、能力边界说明 |
| `tests/` | `node --test` |

## 当前状态

<!-- OWNER-VERIFY -->
核对时间 2026-11-06（第二轮，UTC 下午）。逐条判据与复算方式在 `docs/EVIDENCE.md`，这里只给结论。

**已经在线上跑通的：**

- 站点已上线且 push 即部署：`https://smartlotus.github.io/lotus-muse-site/`
  （GitHub Actions `Deploy to GitHub Pages`，push 到 main 自动构建 `site/` 并发布，最新 run 绿）。
  首页含 3 条记录；`content/site.json` 的 `base_url` 已指向该地址。
- `npm test` 89/89 全绿；构建确定性成立（同一 content 两次构建字节相同）。
- 本机命令行闭环真实跑过：写入 `#0003`、回滚往返、push；模式 B 需要的一切本机已验证。
- 部署通道不依赖 Cloudflare：GitHub Actions 只需要仓库本身，不需要任何云凭据。

**尚未跑通，缺的都是授权而不是能力：**

- 模式 A（Worker API）：Worker 的真实 GitHub 提交需要一把**只限本仓库、只有 Contents 读写**
  的 fine-grained PAT（GitHub 无 API 能替人铸造，须你在网页上建）；且本机当前直连
  `*.workers.dev` 超时（疑似网络墙），接入前先在 Muse 那一侧实测连通性。
- 模式 B（推荐）：需要给 Muse 的云电脑一把**单仓库凭据**（deploy key 或同一把 PAT），
  步骤在 `muse/MODE-B-SETUP.md`，凭据注入需要你操作一次。
- 遗留：Cloudflare Pages 上的旧副本 `lotus-muse-site.pages.dev` 停在 2 条记录；
  wrangler OAuth 已过期，要么重新登录后让它追平/接管，要么视为弃用（不影响 github.io 主站）。

原仓库零改动：`lotussblog`、`lotussmindstream`、`LotusSiteManager` 以及本地三份博客副本只被读取过。
<!-- /OWNER-VERIFY -->
