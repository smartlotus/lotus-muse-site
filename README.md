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
（此节由仓库主人最终核对后填写：哪些命令已在真机跑通、Worker 是否已部署、
Muse 连接是否成功、Pages 域名是否生效。协作者请勿代填。）
<!-- /OWNER-VERIFY -->
