# 验收台账（EVIDENCE）

规则：每条都要给"怎么复算"。没跑过的不写在这里。时间均为 UTC。

## A. 已确证的前置事实

| # | 事实 | 证据（可复算） |
|---|---|---|
| A1 | GitHub 账号为 `smartlotus`，`gh` 可用但 token scopes = `gist, read:org, repo, workflow`（＝全仓库可写，禁止交给 Muse） | `gh auth status` |
| A2 | 既有 lotus 站点在 Cloudflare Pages：`lotussblog.pages.dev`（Git 绑定，仓库 2026-05-24 最后推送）、`lotussmindstream.pages.dev`（Git 绑定） | `npx wrangler pages project list`；`gh repo list` |
| A3 | Cloudflare 账号 `ff572908f83b35e7db8e764cc7d6f399`（Smartlotus1130@gmail.com） | `curl -H "Authorization: Bearer <wrangler oauth>" .../accounts` → HTTP 200 |
| A4 | wrangler 的 OAuth 凭据在 `AppData\Roaming\xdg.config\.wrangler\config\default.toml`，直接跑 `wrangler` 报未登录是因为该路径未被读到；用 `CLOUDFLARE_API_TOKEN` 环境变量注入即可正常工作，但该 access token 于 **2026-11-06T08:01:23Z 过期** | 同文件 `expiration_time` 字段；`wrangler whoami` 输出 "logged in with an Account API Token" |
| A5 | Muse 的连接器文档：没写明的命令不存在；无内置连接器时唯一路径是 `credentials.request_api_access`（只接受一个 API key 或对方 OAuth；多密钥/签名/Cookie 的提供方被拒） | `垃圾\_scratch_muse_skill\home_hatch_docs_connectors.md` 第 3–16 行、第 148 行 |
| A6 | 2026-10-10 你已真实让手机 Muse 调通过一个 Cloudflare Worker REST API，形状为 `/health`+`/capabilities`+`Idempotency-Key` | `Documents\Codex\2026-10-10\c-users-28389-desktop-mines-pki\outputs\Muse_首次接入提示词.md` |
| A7 | `LotusSiteManager` 是已完成验收的桌面工具（41 项自动检查、真实发布两次 HTTP 200），但目录内**没有 .git**，源码未版本化 | `myblognew\LotusSiteManager\PHASE1_ACCEPTANCE.md`、`REAL_PUBLISH_ACCEPTANCE_20260810.md`；`git -C LotusSiteManager log` → fatal: not a git repository |
| A8 | 老博客文档已漂移：`MAINTENANCE.md`/`BEGINNER_GUIDE.md` 指向的 `manage-site.bat`、`publish-site.bat` 在盘上不存在，真实入口是 `scripts\site-manager.ps1` | 见 `myblognew\lotussblog-main\`、`projectweb\myblogweb\lotussblog\` |

## B. 本轮已完成的真实动作

| # | 动作 | 状态 | 复算方式 |
|---|---|---|---|
| B1 | 新建**私有**仓库 `smartlotus/lotus-muse-site`（未触碰任何原仓库） | 完成 2026-11-06T07:26:10Z | `gh api repos/smartlotus/lotus-muse-site --jq .full_name+.visibility` |
| B2 | 新建 Pages 项目 `lotus-muse-site`（直传，production branch `main`，id `60731131-963e-443a-b731-42ab21c6a906`） | 完成 | `curl -H "Authorization: Bearer $T" .../pages/projects?per_page=100` |
| B3 | Pages 通道端到端可用：探针部署 + 从公网取回字节 + 断言标记存在 | 完成（HTTP 200，`BOOTMARKER-7f3a9c` 命中 1 次，deployment `b97a1bf5.lotus-muse-site.pages.dev`） | `node scripts/live-verify.mjs --base https://lotus-muse-site.pages.dev --expect <marker>` |
| B4 | 本地 `git init -b main` + remote 指向新仓库；`core.autocrlf=false`（避免本机 autocrlf 打穿字节比对） | 完成 | `git -C lotus-muse-site config --get core.autocrlf` |
| B5 | Muse 入口 token 已生成（35 字符，只写入 gitignored 的 `.dev.vars`，不进聊天、不进仓库） | 完成 | `grep -c . .dev.vars`；`git check-ignore -v .dev.vars` |
| B6 | 真实站点已上线：`https://lotus-muse-site.pages.dev/` HTTP 200，首页含站点名与两条记录标题，产物里零 `undefined.NaN` 污染；构建确定性成立（两次构建字节相同） | 完成（deployment `f4061d39`，07:43Z） | `curl -s https://lotus-muse-site.pages.dev/ \| grep -c 把站点交给` |
| B7 | Worker 已上线并注入 `MUSE_API_TOKEN`：`https://lotus-muse-api.smartlotus1130.workers.dev` | 完成（版本 `7e04985a`，07:49Z） | `curl .../health`；`npx wrangler deployments list` |
| B8 | **Muse 的调用形状在公网被证实**：`GET /health` 200 且报 `mode:"dry-run"`；`GET /capabilities` 无 token 401、带 token 200 并回真实 scopes；`POST /entries` 带 token 返回 200，`planned_files` 共 16 项，全部落在 `content/ site/ backups/` 前缀内、越界项 0，序号取到 3，`deploy.url` 指向 `/entries/0003.html` | 完成，原始响应存档在 `docs/evidence-live-post.json` | `curl -X POST -H "Authorization: Bearer $(grep MUSE_API_TOKEN .dev.vars \| cut -d= -f2)" -H 'content-type: application/json' -d '{...}' .../entries` |
| B9 | 未鉴权写请求被拒：无 token 的 `POST /entries` 返回 401 | 完成（公网实测） | 同上，去掉 Authorization 头 |
| B10 | 本机 CLI 真实写入一条记录并接续序号、快照、重建、提交：`#0003 2026.11.6 下午 命令行写入的一条记录`，提交 `062e099` | 完成 | `node scripts/lotus.mjs status`；`git show 062e099 --stat` |
| B11 | 回滚真实往返：先 `restore` 到 0003 之前（首页命中数变 0，提交 `6d0e996`），再 `restore` 回本次快照（命中数回到 1，提交 `9abfd66`） | 完成 | `node scripts/lotus.mjs restore --backup backups/<目录>`；`grep -c 命令行写入 site/index.html` |
| B12 | 测试 89/89 全绿（model 27 / template 21 / build 合同 7 / http 路由 7 / gh 客户端 11 / worker 16） | 完成 | `npm test` |
| B13 | 代码与内容已推送，且**远端 SHA 与本地相等** | 完成 `9abfd66342ed07667a8721c622038b617d064392` | `git rev-parse HEAD` 与 `gh api repos/smartlotus/lotus-muse-site/commits/main --jq .sha` 对读 |
| B14 | 原仓库零改动：`lotussblog`、`lotussmindstream`、`LotusSiteManager` 及本地三份博客副本本轮未被写入 | 完成（只读检查） | `git -C .../lotussblog status`；目录 mtime |
| B15 | 代码可移植性核查（决定"能不能让 Muse 在它自己的云电脑里直接跑"）：`package.json` 无任何 dependencies/devDependencies、盘上无 `node_modules`、外部命令只有 `git`（`scripts/lotus.mjs:277`）、路径全走 `path.join`/`path.sep`、无 `process.platform`/PowerShell/`.bat` 假设 | 成立 | `node -e "const p=require('./package.json');console.log(p.dependencies,p.devDependencies)"`；`grep -rn "win32\|powershell\|\.bat" scripts lib api` → 0 命中 |
| B16 | 文档与实现的口径对账揪出并改掉两处假话：ARCHITECTURE 图里写 "main 分支自动构建"、CONNECT-SETUP 里写 "推送后 Pages 照常自动部署"——Pages 现在是直传形态，两者都不成立，已改为如实描述并给出真正生效的部署命令 | 完成 | `grep -rn "自动构建\|自动部署" docs muse` |

## C. 尚需人类动作（不是能力缺口，是授权边界）

| # | 需要你做的事 | 为什么不能由我做 |
|---|---|---|
| C1 | 建一把 GitHub **fine-grained PAT**：Only select repositories → `lotus-muse-site`；Permissions 仅 `Contents: Read and write`；到期设 90 天 | GitHub 不提供任何 API 用来铸造 PAT；本机 `gh` 的 OAuth 也做不到 |
| C2 | 在 Muse 的安全密钥入口（自定义连接器 `credentials.request_api_access` 生成的托管连接页）填入 `.dev.vars` 里那把 `MUSE_API_TOKEN` | 只有你的 Muse 账号能操作 |
| C3 | 让 wrangler 重新登录一次：`npx wrangler login`（现有 OAuth token 今日 08:01Z 过期） | OAuth 授权必须你本人在浏览器完成 |

## D. 判据完成情况（对照 CONTRACT §6）

- [x] `npm test` 全绿 89/89；且每条都能因退化变红（本轮实测抓出 4 个真缺陷：
  路由 `:param` 永不匹配、日期正则缺捕获组、`gh.put` 可盲目覆盖、构建产物越界前缀）
- [x] 构建确定性：同输入两次 `buildSite` 字节相同（`tests/build-contract.test.mjs`）
- [x] 本机 CLI 真实产出记录并提交/推送（B10、B13）
- [x] Worker 部署上线，`/health` 与 `/capabilities` 公网可达（B7、B8）
- [x] 未鉴权写 → 401；鉴权 dry-run 写 → `planned_files` 完整且零外部调用（B8、B9；
  零网络那条由 `tests/worker.test.mjs` 的 fetch 间谍断言）
- [ ] **配好 C1+C3 后**：重部署 Worker 与 Pages，使线上版本追平仓库
  （当前线上 Worker 是 `7e04985a`，其后仓库还有 3 处修复；线上 Pages 是 2 条记录，仓库已是 3 条）

## E. 第二轮审计（2026-11-06 下午 UTC，本轮）

规则同前：每条都给"怎么复算"，没跑过的不写。这一轮的背景：部署通道在两轮之间
被切到了 GitHub Pages（仓库出现 `6bfd6d7 ci: add GitHub Pages deploy workflow` 与
`ff0f197 style: …` 两个提交），本轮据实审计并把全部文档口径对齐到新通道。

| # | 事实 | 证据（可复算） |
|---|---|---|
| E1 | 部署主通道已是 GitHub Pages：`https://smartlotus.github.io/lotus-muse-site/`，`build_type=workflow`，状态 `built` | `gh api repos/smartlotus/lotus-muse-site/pages` → `html_url`/`status` |
| E2 | push 即部署实测成立：`ff0f197`（style）push 后 run `42210875778` success（1m8s）；workflow 内容 = checkout → `node scripts/lotus.mjs build` → `deploy-pages@v4` | `gh run list --limit 5`；`.github/workflows/pages.yml` |
| E3 | 线上内容 = 仓库内容：github.io 首页含 `命令行写入的一条记录`（#0003），并列出 `entries/0001..0003.html` | `curl -s https://smartlotus.github.io/lotus-muse-site/ \| grep -c 命令行写入的一条记录` → 1 |
| E4 | Cloudflare Pages 旧副本停止追新：`lotus-muse-site.pages.dev` 返回 200 但不含 #0003，成为陈旧副本 | `curl -s https://lotus-muse-site.pages.dev/ \| grep -c 命令行写入` → 0 |
| E5 | Worker 本机当前不可达：`curl https://lotus-muse-api.smartlotus1130.workers.dev/health` 连接超时（15s，HTTP 000）；当天上午（07:49Z）曾 200。疑似 `*.workers.dev` 直连被墙；Muse 云端/手机侧连通性未测 | `curl -sv --max-time 15 …/health` |
| E6 | `.dev.vars` 里 `GITHUB_TOKEN` 与 `CLOUDFLARE_API_TOKEN` 为**空值**（len=0）→ C1（细粒度 PAT）从未完成；`MUSE_API_TOKEN` 在（`lm_` 前缀，35 字符） | `awk -F= '{print $1, length($2)}' .dev.vars` |
| E7 | 本机对 `github.com:443` 的 git 通道走 HTTP/2 会被重置，HTTP/1.1 正常；已在仓库本地配置 `http.version=HTTP/1.1` 并完成 fast-forward 同步到 `ff0f197` | `git config --get http.version`；`git log --oneline -1` |
| E8 | 本轮把 `base_url` 统一切到 github.io（`content/site.json`、`api/wrangler.toml`、`api/src/fallback-state.mjs` 经生成脚本重造、本地 `.dev.vars`），渲染产物不受影响（HTML 不含 base_url），`site/` 重建后零字节变化 | `git status --short`（只有 3 个配置文件）；`node scripts/lotus.mjs build` 前后 diff |
| E9 | 契约与全部文档口径已对齐双通道事实：CONTRACT §0、README、RUNBOOK §2/§7/§8/§9、CONNECT-SETUP §4/§4.5、SKILL 的公开地址、新增 `muse/MODE-B-SETUP.md` | `grep -rn "pages.dev\|github.io" docs muse README.md` 逐条核对语境 |
| E10 | 本轮测试与构建保持全绿：`npm test` 89/89；构建确定性维持 | `npm test` |

### 第二轮之后仍欠的人工动作（更新版）

| # | 需要你做的事 | 对应通道 |
|---|---|---|
| H1 | 给 Muse 的云电脑一把**单仓库凭据**：优先在 Muse VM 里生成 ed25519 密钥对，把公钥交给管理员（我）登记为 `lotus-muse-site` 的**只读/读写 deploy key**（可用 `gh api repos/smartlotus/lotus-muse-site/keys` 完成，无需你上 GitHub 网页）；或按 RUNBOOK §3.2 铸造 fine-grained PAT | 模式 B（推荐） |
| H2 | （仅模式 A 需要）完成 C1 的 fine-grained PAT + 在 Muse 安全密钥入口填 `MUSE_API_TOKEN`（C2） | 模式 A |
| H3 | （可选，二选一）Cloudflare 决策：a) 弃用 pages.dev 旧副本；或 b) `npx wrangler login` 后按 RUNBOOK §8 让它追平。不做也不影响 github.io 主站 | 遗留清理 |
| H4 | 对 Muse 发出 `muse/MODE-B-SETUP.md` 里的首条指令，走完一次端到端验收 | 模式 B |
