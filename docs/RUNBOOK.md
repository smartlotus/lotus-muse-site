# 运维手册（RUNBOOK）

从零到能用，以及日常出问题时看哪里。所有 `npx wrangler` 命令在本仓库根目录
执行；第一次会打开浏览器要求登录 Cloudflare。GitHub 侧动作在网页上完成即可，
不需要本机 gh 登录。绝不把本机 `gh` 的账号级 token 填进任何 secret。

## 1. 创建 GitHub 仓库（新仓库，不碰旧仓库）

1. 在 GitHub 网页 New repository，名字必须叫 `lotus-muse-site`，
   可见性 Public（Pages 免费档要求），不要初始化 README/license
   （本地已有完整内容）。
2. 本机首次推送：

   ```powershell
   git remote add origin https://github.com/<你的账号>/lotus-muse-site.git
   git add -A
   git commit -m "lotus-muse-site 初版"
   git push -u origin main
   ```

   注意：这是唯一一段"人来推第一次"的流程；之后的日常维护全部走
   `scripts/lotus.mjs --commit --push` 或 Muse 经 Worker，不再手工碰。

## 2. 连接 Cloudflare Pages

1. Cloudflare 控制台 -> Workers & Pages -> Create -> Pages -> Connect to Git，
   选 `lotus-muse-site`，production branch = `main`。
2. 构建设置：Output directory 填 `site`，Build command 留空
   （仓库里已提交构建好的 `site/`，Pages 免构建直接用）。
3. 部署一次后记下稳定域名 `https://lotus-muse-site.pages.dev`，
   它应与 `content/site.json` 的 `base_url` 一致，不一致就改 JSON 再提交。

## 3. 部署 Worker API

1. 编辑 `api/wrangler.toml`：确认 `name = "lotus-muse-api"`
   （account subdomain 决定 API 的 Base URL）。
2. 签发 fine-grained PAT（这就是"精确设置"，逐项核对）：
   - GitHub -> Settings -> Developer settings -> Fine-grained tokens。
   - Repository access: **Only select repositories**，只勾 `lotus-muse-site`。
   - Permissions: **Contents: Read and write**。仅此一项
     （Membership/Metadata 之外的都别开；Metadata 若界面默认带上，保留无害）。
   - Expiration: 设一个你会记得的到期日（如 90 天）。
3. 配 secret（每条都是交互式粘贴，不进任何文件）：

   ```powershell
   npx --yes wrangler secret put GITHUB_TOKEN    # 上一步的 PAT
   npx --yes wrangler secret put MUSE_API_TOKEN  # 值取本机 .dev.vars 里的 MUSE_API_TOKEN
   npx --yes wrangler deploy
   ```

4. 验证：

   ```powershell
   curl https://lotus-muse-api.smartlotus1130.workers.dev/health
   ```

   期望 `{"ok":true,"mode":"live",...}`。`mode` 仍是 `dry-run` 说明
   `GITHUB_TOKEN` 没配上，先别接入 Muse。

## 4. 接入 Muse

照 `muse/CONNECT-SETUP.md` 走。要点复述：Muse 对话里提出自定义连接器 ->
它给托管连接链接 -> 你在官方页面粘贴 `MUSE_API_TOKEN` 那一把 ->
让 Muse 先 `GET /health` 再 `GET /capabilities` 自证连接成立。
话术从 `muse/PROMPTS.md` 里抄。

## 5. 日常操作

| 想做的事 | Muse（连好之后） | 本机 CLI（永远可用的兜底） |
|---|---|---|
| 加一条记录 | 见 PROMPTS 第 1 条 | `node scripts/lotus.mjs add-entry --title ... --body ... --commit --push` |
| 带图记录 | 见 PROMPTS 第 2 条（发图给它） | `node scripts/lotus.mjs add-entry --image 某图.png ...`（图先放仓库任意处或 media/） |
| 上新网页 | 见 PROMPTS 第 3 条 | `node scripts/lotus.mjs add-page <slug> --title ... --body-file 正文.txt --commit` |
| 改/删 | 见 PROMPTS 第 4、5 条 | `edit-entry` / `delete-entry` / `edit-page` / `delete-page` |
| 重新发布 | 见 PROMPTS 第 6 条 | `node scripts/lotus.mjs republish --commit --push` |
| 回滚 | 见 PROMPTS 第 7 条 | `node scripts/lotus.mjs restore --backup backups/<快照目录> --commit` |
| 查改动流水 | 见 PROMPTS 第 8 条 | `node scripts/lotus.mjs status` |
| 纯重建 | 不需要 | `node scripts/lotus.mjs build` |

每次写操作的线上确认动作（人和 Muse 都该做）：

```powershell
node scripts/live-verify.mjs --expect "<这次独有的文字>" --entry <seq>
```

## 6. 回滚细则

1. 先看流水找锚点：`GET /journal?limit=20` 或 `node scripts/lotus.mjs status`，
   事件里的 `backup` 字段就是可用快照目录。
2. 整树恢复：`POST /actions/restore` 带 `{"backup":"backups/<目录>"}`，
   或本地 `restore --backup backups/<目录> --commit --push`。
   恢复动作自己也会先快照当前状态，可以再恢复回来。
3. 只回滚一条记录：`POST /actions/rollback-entry` 带
   `{"sequence":7,"backup":"backups/<目录>"}`。
4. 最后手段：直接看 git 历史，`git revert <坏提交>` 再推送。
   永远不要 force push 或改写历史（契约第 5 节第 4 条）。

## 7. 站点看起来是旧的，按此顺序查

1. `node scripts/live-verify.mjs --expect ...` 先确认是不是"根本没写进去"。
2. GitHub 仓库 `main` 分支上最新提交对不对？journal 最后一条对不对？
   不对 -> 是写入问题，查 Worker（下一步）；对 -> 是发布问题（再下一步）。
3. Worker：`curl /health` 的 `mode` 是否 `live`； Workers 控制台看该 Worker
   的实时日志（只有 action 与结果码，不含内容）。401 是门票问题，
   503 `github_unauthenticated` 是 PAT 过期/被撤，502 `github_failed`
   多半是远端领先冲突，让 Muse 重试一次或本地 `--push` 前先 pull。
4. Pages：项目 Deployments 页看最新一次部署的分支与时间；
   Git 触发部署偶尔排队，等一两分钟再验。
5. 缓存：`Ctrl+F5` 或加查询串（`/?v=2`）排除浏览器缓存；
   Pages 对 HTML 默认不缓存长，一般不是它。
6. 都没问题但内容仍旧：检查 `content/site.json` 的 `base_url` 是否指向
   你正在看的域名（多项目并存时最容易错这里）。

## 8. 把线上追平到仓库（本轮交付时留下的欠账）

本轮线上版本落后于仓库，原因是 wrangler 的 OAuth token 在 2026-11-06T08:01Z 到期，
之后的两次部署动作没法再做。落后状态是明确的、可一次性补平的：

| 落后项 | 线上 | 仓库 |
|---|---|---|
| Worker 版本 | `7e04985a`（07:49Z） | 其后还有 3 处修复：路由参数匹配、`gh.put` 必须先读 sha、错误信息带原因且不泄漏 token |
| Pages 记录数 | 2 条（deployment `f4061d39`） | 3 条（`#0003` 由本机 CLI 写入） |

按序执行（PowerShell，仓库根目录）：

```powershell
cd C:\Users\28389\Desktop\myblognew\lotus-muse-site
npx --yes wrangler login          # 唯一必须你本人点浏览器的动作
node scripts/lotus.mjs build      # 用仓库里的 content/ 重新生成 site/
npx --yes wrangler pages deploy site --project-name lotus-muse-site --branch main --commit-dirty=true
cd api
npx --yes wrangler deploy
npx --yes wrangler secret put MUSE_API_TOKEN   # 值在本机 .dev.vars 里，别贴到聊天
node ../scripts/live-verify.mjs --base https://lotus-muse-site.pages.dev --expect "命令行写入的一条记录"
```

判据不是"deploy 打印了 Success"，而是最后一行 `live-verify` 全 PASS——
它真的去公网取回字节并逐条断言。

## 9. 切换到模式 B（Muse 用自己的云电脑直接跑 CLI）

只有当 `muse/PROBE-VM.md` 的四条能力都成立时才做。目的是让 Muse 只需一把单仓库 PAT，
push 完 Pages 自己部署，从而不再需要 Worker、也不再需要 Cloudflare 凭据进它的会话。

前提（这一步我没有实测，需要你在登录后确认，它只影响下面第 1 小步能不能成）：
Cloudflare Pages 的 Git 集成依赖 GitHub 上的 **Cloudflare Pages App** 已被授权到该仓库。
你账号下 `lotussblog`、`lotussmindstream` 等项目的 "Git Provider" 都是 Yes，说明这个 App 早就装好了；
不确定的是它的授权范围是"All repositories"还是"Only select repositories"。

1. 给仓库授权（二选一）：
   - GitHub → `smartlotus/lotus-muse-site` → Settings → Integrations → Cloudflare Pages → Add repository；
   - 或者在 https://github.com/settings/installations 里把该 App 改成对所有仓库生效。
2. 在 Cloudflare 侧开启 Git 构建（Dashboard 最稳：Workers & Pages → lotus-muse-site →
   Settings → Build configs → Connect to Git，选 `main`）：
   - Build command：`node scripts/lotus.mjs build`
   - Output directory：`site`
   - Root directory：仓库根
3. 验证链路而不是验证配置：`node scripts/lotus.mjs add-entry … --commit --push`，
   然后等 Pages 出新部署，再用
   `node scripts/live-verify.mjs --base https://lotus-muse-site.pages.dev --expect <新记录标题>`
   打到公网断言。**判据是线上字节里真的有这句话**，不是"push 成功了"。
4. Worker 保留但降级：`api/` 不删，它仍是"任何没有本地工具链的助手"的入口；
   模式 B 期间不需要给它配 `GITHUB_TOKEN`，它会自动停在 `dry-run`，这是预期状态而不是故障。
5. 模式 B 的额外规矩（写进给 Muse 的首条指令里）：
   - 只许调 `node scripts/lotus.mjs …`，**不许直接编辑 `site/` 下任何文件**；
   - 每次动手前先 `git fetch && git status`，工作区不干净就停下来报告而不是硬来；
   - 改完必须自己跑 `npm test` 与 `live-verify`，两样都绿才算做完；
   - 不提交 `.dev.vars`，不把我给你的 PAT 写进任何文件或提交记录。

## 10. 本地演练（不依赖任何云）

```powershell
node scripts/lotus.mjs build                    # 本地全量构建
npx --yes serve -s site -l 5055                 # 起静态站（另开终端）
node scripts/live-verify.mjs --base http://127.0.0.1:5055 --expect "<标记>" --entry <seq>
node scripts/serve-api.mjs --dry-run --port 8787  # 本地跑真实 Worker 代码
curl http://127.0.0.1:8787/health
```

`.dev.vars` 里放本地演练用的 `MUSE_API_TOKEN`（不要放真实 PAT；
dry-run 模式按契约就是不写 GitHub 的）。`.dev.vars` 已在 `.gitignore` 里。
