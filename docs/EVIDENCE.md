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

## C. 尚需人类动作（不是能力缺口，是授权边界）

| # | 需要你做的事 | 为什么不能由我做 |
|---|---|---|
| C1 | 建一把 GitHub **fine-grained PAT**：Only select repositories → `lotus-muse-site`；Permissions 仅 `Contents: Read and write`；到期设 90 天 | GitHub 不提供任何 API 用来铸造 PAT；本机 `gh` 的 OAuth 也做不到 |
| C2 | 在 Muse 的安全密钥入口（自定义连接器 `credentials.request_api_access` 生成的托管连接页）填入 `.dev.vars` 里那把 `MUSE_API_TOKEN` | 只有你的 Muse 账号能操作 |
| C3 | 让 wrangler 重新登录一次：`npx wrangler login`（现有 OAuth token 今日 08:01Z 过期） | OAuth 授权必须你本人在浏览器完成 |

## D. 待跑完的判据（交付前必须全绿，见 CONTRACT §6）

- [ ] `node --test tests/` 全绿，且每条断言都能因退化而变红
- [ ] 构建确定性：同输入两次 `buildSite` 字节相同
- [ ] 本机 CLI 真实产出一条记录并提交/推送到 B1 仓库
- [ ] Worker 部署上线，`/health` 与 `/capabilities` 公网可达
- [ ] 未鉴权写请求 → 401；鉴权 dry-run 写请求 → `planned_files` 完整且零外部调用
- [ ] 配好 C1 后：一次真实 `POST /entries` → GitHub 出现 `lotus-muse-bot` 提交 → Pages 直传成功 → 线上页真的含新文本
- [ ] 一次真实回滚：`restore --backup …` 后线上页回到旧内容
