# 模式 B：让 Muse 在它自己的云电脑里维护这个站（当前推荐）

一句话：**把仓库给 Muse，它在自己机器上只跑 `scripts/lotus.mjs`，push 完线上自动更新。**
不需要 Worker，不需要 Cloudflare，不需要再配任何 API——部署由 GitHub Actions
自动完成（push 到 main → 构建 `site/` → 发布到
<https://smartlotus.github.io/lotus-muse-site/>，通常一两分钟）。

什么时候用模式 B，什么时候用模式 A（Worker API）：

| 你的处境 | 用哪个 |
|---|---|
| Muse 的云电脑有 node + git、能出网（用 `PROBE-VM.md` 实测过） | **模式 B** |
| Muse 只能调自定义连接器，或者你不想给它任何 git 凭据 | 模式 A（`CONNECT-SETUP.md`） |
| 两者都行 | 模式 B：凭据只作用于这一个仓库，链路更短 |

## 0. 前提探测（一次性）

把 [`PROBE-VM.md`](PROBE-VM.md) 的整段话粘给 Muse，逐条实测它的环境：
node ≥ 20、git、能访问 `api.github.com` 与 git 通道、有无官方密钥注入入口。
四项里 node/git/出网必须全过；密钥入口的形式决定第 1 步走哪条路。

## 1. 给 Muse 一把单仓库凭据（只有这一步需要人）

两条路，选其一。两条的爆炸半径都被限制在 `lotus-muse-site` 这一个仓库里，
都不使用本机 `gh` 的账号级 token（红线见 `../docs/SECURITY.md`）。

### 路 1（推荐）：deploy key

1. 对 Muse 说：

   > 在你的环境里生成一把专用 SSH 密钥：`ssh-keygen -t ed25519 -N "" -f ~/.ssh/lotus_site_deploy`
   > 然后把**公钥**（`~/.ssh/lotus_site_deploy.pub` 的完整内容）原样发给我。
   > 私钥不要发，也不要写进任何文件或日志。

2. 把它给的公钥交给管理员（ZCode/本机），登记为这个仓库的 deploy key：

   ```powershell
   gh api repos/smartlotus/lotus-muse-site/keys -f title="muse-vm" -f read_only=false -f key="<粘贴公钥>"
   ```

   deploy key 天然只作用于这一个仓库、不含账号任何其他权限、无到期日；
   随时可在 GitHub 仓库 Settings → Deploy keys 或一条 API 调用里撤销。

3. 告诉 Muse：

   > 公钥已登记。你的私钥在 `~/.ssh/lotus_site_deploy`，
   > 用 `git -c core.sshCommand="ssh -i ~/.ssh/lotus_site_deploy" clone git@github.com:smartlotus/lotus-muse-site.git`
   > 克隆（或配置 `GIT_SSH_COMMAND`）。试一次 `git fetch`，通了我再给你任务。

### 路 2：fine-grained PAT

按 `../docs/RUNBOOK.md` 第 3.2 节铸造（Only select repositories → `lotus-muse-site`，
仅 Contents: Read and write），经 Muse 的官方安全密钥入口注入。
若它的规则是"只许会话内使用、不落盘"，也可以用，但每次新会话都要重贴一次，
且密钥会留在对话记录里——知道这个代价再选它。

## 2. 给 Muse 的首条指令（克隆完成后整段发送）

```text
从现在起你负责维护我的个人站点仓库 smartlotus/lotus-muse-site（你已克隆到本地）。
这是长期职责，遵守以下硬规矩，任何一条冲突都先停下来问我：

1. 只许用 `node scripts/lotus.mjs <命令>` 改站点内容；site/ 目录全部由构建器生成，
   你永远不许手改 site/ 下任何文件。
2. 每次动手前先 `git fetch` + `git status`；工作区不干净或远端领先，先报告，不要硬来。
3. 每次写操作走完整闭环：改 content/ → `node scripts/lotus.mjs build` → `npm test`
   → `--commit --push` → 用
   `node scripts/live-verify.mjs --expect "<这次独有的文字>"` 到
   https://smartlotus.github.io/lotus-muse-site/ 上断言新内容真的出现。
   push 成功不算完成，线上字节里找得到才算。
4. 不许 force push、不许改写历史、不许删 backups/、不许碰 .dev.vars、
   不许把我给你的密钥写进任何文件、提交信息或日志。
5. 提交信息格式照旧（git log 里看得到惯例）；说不准就直接引用我的原话做正文。

先做三件事证明你接上了：跑 `node scripts/lotus.mjs status` 把站点现状报给我；
跑 `npm test` 把结果报给我；然后等我下第一条维护指令。
```

## 3. 第一条真实维护任务的验收

对 Muse 说一条小任务（例如：加一条记录，正文带一个独有词）。完成后逐项核对：

- [ ] 它先读了现状并复述要写入的内容，经你同意才动手
- [ ] GitHub 仓库出现一个新提交（提交者是 deploy key 对应的身份或你指定的作者名）
- [ ] Actions 页 `Deploy to GitHub Pages` 新 run 绿（一两分钟）
- [ ] `node scripts/live-verify.mjs --expect "<独有词>"` 全 PASS（本机跑，或让它跑并贴原始输出）
- [ ] journal（`node scripts/lotus.mjs status`）多了一条事件，actor 如实

## 4. 出问题看哪里

| 症状 | 先看 |
|---|---|
| push 被拒（non-fast-forward） | 它没先 `git fetch`；让它 pull --ff-only 后重试，教训记进它的会话 |
| push 通了但线上没变 | 仓库 Actions 页看 run 是否失败；`live-verify` 加 `--base` 显式指定；等两分钟再判 |
| deploy key 认证失败 | 公钥/私钥是否配对、`GIT_SSH_COMMAND` 是否指对文件、key 是否被撤销 |
| 测试红 | 立即停，不许 push；把失败输出贴回来等处理 |
| 手快改坏了 site/ | `git checkout -- site/` 丢弃；真正的内容回滚走 `lotus.mjs restore` |

## 5. 模式 A（Worker）与模式 B 的关系

Worker（`api/`）保留为备胎：任何"没有本地工具链的助手"仍可通过它维护站点，
未配 PAT 时自动停在 dry-run（这是预期行为）。两模式写的是同一个仓库、
同一套 content/、同一个 journal，回滚与快照机制完全共用，随时可切换或并用。
