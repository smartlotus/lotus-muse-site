# Muse 在这个体系里结构性做不到的事

这不是"暂时没配好"，而是能力面本身不含这些。逐条给证据。

## 1. 它的命令集里没有 git，没有 GitHub，没有 Cloudflare

证据：Muse 自己的连接器文档（connectors.md）第一条规则：
"Connectors give you exactly the commands in their skill documentation,
nothing more."（连接器只给它那份 skill 文档里写明的命令，一句都不多。）
其文档列举的连接器是 Facebook、Instagram、Spotify、Opentable、Calendly、
Gmail、Google 全家桶这类服务，从未出现 git、GitHub、Cloudflare、Wrangler
这类开发运维工具；文档还明确"如果某个命令没被文档列出，它就不存在，
重新连接也不会解锁"。

结论：Muse 不能 clone、commit、push、开 PR、改仓库设置、触发 Pages 构建、
也不能碰 Worker 的 secret。任何此类说法都是它在自己发明能力。

> 边界说明（2026-11-06）：本节的"它"指**通过连接器驱动的 Muse 工具面**——
> 连接器只给 skill 文档列出的命令。Muse 的**云电脑（VM）执行环境**是另一回事：
> 它可能装有 node 与 git（用 `PROBE-VM.md` 实测，不许凭印象）。只有实测通过、
> 并且凭据被限制为单仓库 deploy key / fine-grained PAT 时，才允许走
> [`MODE-B-SETUP.md`](MODE-B-SETUP.md) 的模式 B——那是给它的环境开了
> 一条受控的口子，不是本节结论失效。模式 A 下本节逐字成立。

## 2. 我们这类自托管服务只能走"一个 Key"的形状

证据：connectors.md 第 148 行（"Invented connect flows"一节）：没有内置
connector 的服务不存在设置面板、服务器 URL 输入框或自定义 auth header；
唯一真实路径是 custom connector 流程 `credentials.request_api_access`，
由它铸造一个托管连接链接，用户在页面里输入一个 API Key（或用提供方自己的
OAuth 登录）；"需要密码登录、会话 cookie、请求签名或多于一个密钥的提供方
会被点名拒绝"。

结论：把 GitHub 账号或 Cloudflare 账号直接"授权"给 Muse 这条路不存在。
本仓库把全部特权收进一个 Worker：Worker 内部持细粒度 GitHub PAT 和
Pages 上传凭据，而 Muse 只拿一把 Bearer Key 访问这一层 HTTPS JSON API。
这正是唯一能被连接器吃下的形状，也是特权最小化的形状。

## 3. 因此 API 是诚实的唯一通道，并且被设计成可验证

- Muse 一切动作都留下两类外部证据：GitHub 提交历史（作者 `lotus-muse-bot`）
  与 `content/journal.jsonl` 只增流水。它做不到这两样以外的任何事。
- 写接口全部要求 `expect_sequence` 之类的读后确认，防它凭记忆瞎写。
- SKILL 第 4 条强制它写后抓线上页面核对：API 返回 200 不算完成。
- 若它的 token 泄漏，爆炸半径是这一个仓库的 contents 读写，
  不是账号，不是 Cloudflare，不是其他仓库（详见 `../docs/SECURITY.md`）。

## 4. 对用户的直接含义

- Muse 说"我帮你回滚一下 git"或"我去 Cloudflare 重启构建"时，那是假的，
  真实可说的是 `POST /actions/restore` 和 `POST /actions/republish`。
- 你随时可以只用 `scripts/lotus.mjs` 做同样的事，两者殊途同归于同一个仓库
  与同一条 Pages 流水线。
- 断开连接不影响站点继续在线；恢复人工维护零成本，因为内容就是仓库里的 JSON。
