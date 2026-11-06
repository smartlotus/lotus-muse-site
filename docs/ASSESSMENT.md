# 可行性判断：把 lotus 个人站点交给 Muse 维护

结论：**想法成立，但不能按"把 GitHub 交给 Muse"来实现；成立的形状是"Muse 只调用一个我们自己的
HTTP 接口，由接口去改仓库和部署"。** 下面是判据，不是推测。

## 1. 现状核实（本机 + GitHub + Cloudflare）

已部署、仍在跑的 lotus 站点，按 Cloudflare Pages 项目列表与 GitHub 仓库对照：

| 站点 | GitHub 仓库 | Pages 域名 | Git 绑定 | 最近推送 |
|---|---|---|---|---|
| lotussblog（主博客） | smartlotus/lotussblog（私有） | lotussblog.pages.dev | 有 | 2026-05-24 |
| lotussmindstream | smartlotus/lotussmindstream（私有） | lotussmindstream.pages.dev | 有 | 2026-03-18 起 |
| lotusspage / lotussinsight | 私有仓库存在 | 见 Pages 列表 | — | 2026-03 |
| lotus30-figures-web | 公开 | — | — | 2026-11-05 |

本机对应目录：`C:\Users\28389\Desktop\projectweb\myblogweb\lotussblog`（origin 已核）、
`C:\Users\28389\Desktop\myblognew\myblogweb\lotussblog`、`...\myblognew\lotussblog-main\`（三份副本，已分叉）。

另外两件重要的既有资产：

1. `C:\Users\28389\Desktop\myblognew\LotusSiteManager\` —— 一个**已完成并验收过**的 .NET 桌面工具
   （v1.1.1 · 2026.08.09-cf-ui3）：新建日志网站、固定模板、草稿自动保存、两步"生成并预览→确认发布"、
   20 份发布前快照、回收恢复、`git fetch` 后才发布、从不强推。
   `PHASE1_ACCEPTANCE.md` 记 22 项功能与 41 项自动检查通过，`REAL_PUBLISH_ACCEPTANCE_20260810.md`
   记真实建库＋真实 Pages 发布两次并 HTTP 200。
   **但它自己没进版本控制**（该目录无 `.git`），且它的写入端是"人点按钮"，不是 agent。
2. `C:\Users\28389\Documents\Codex\2026-10-10\c-users-28389-desktop-mines-pki\outputs\Muse_首次接入提示词.md`
   —— 2026-10-10 你已经**真的让手机 Muse 调通过一个 Cloudflare Worker REST API**
   （`pki-agent-api.smartlotus1130.workers.dev`）：`GET /health` 判连通、`GET /capabilities` 判实际权限、
   `Idempotency-Key` 幂等、401/403 即停、409 不换键、写操作由你在本人网页核对。
   **这是本判断最重要的经验证据：Muse→自建 API 这条路在你自己身上已经跑通过。**

## 2. Muse 能做到什么、做不到什么（依据 Muse 自己的文档）

判据文件：`C:\Users\28389\Desktop\垃圾\_scratch_muse_skill\home_hatch_docs_connectors.md`

- 第 3–16 行的核心规则：**连接器只提供它 skill 文档里写明的命令，没写明的命令不存在**。
  这份文档里没有任何 git、GitHub、Cloudflare、静态托管的命令。
  所以"Muse 直接 push 我的仓库 / 直接部署我的站点"今天**不成立**。
- 第 148 行给了唯一真路径：没有内置连接器的服务，**没有**可填服务器 URL、transport、auth-header 的设置面板，
  只能走自定义连接器流程 `credentials.request_api_access`，由它生成一个托管连接入口，
  用户在里面填**一个 API key** 或用服务方自己的 OAuth 登录；
  而"用密码登录、会话 Cookie、请求签名或需要多把密钥"的提供方会被**直接拒绝**。
  → 这正好规定了我们的接口形状：**一个 HTTPS JSON 接口 + 一把 Bearer Token，无签名、无 Cookie**。
- 权限粒度：连接器 manifest 的 `actions.write.default: ask` + `approval_phrase`
  （见同目录 `opt_hatch_skills_calendly_manifest.yaml`）说明写操作默认要先取得你本人的同意——
  这是好事，等于天生带一道人工闸。
- Muse 的 VM 里确有代码执行能力（同目录 `opt_hatch_skills_artifacts_testing_SKILL.md` 提到
  `muse.exec`），但它的出口网络是否允许 `git clone`/`push` 到 github.com 没有任何文档依据，
  而"让它能 push"就必然要把凭据放进一个我控制不了的网络环境。**不把这条当作方案。**

## 3. 因此成立的架构（和为什么不是别的）

```
你说话 -> Muse -> 自定义连接器（只有 1 把 Bearer Token）
                     -> Cloudflare Worker: lotus-muse-api
                          1) 鉴权 + 校验 + 规范化内容
                          2) 用「单仓库细粒度 PAT」把 content/ 与构建产物提交进 lotus-muse-site
                          3) 提交成功后把 site/ 直传 Cloudflare Pages，拿到确切部署 URL
                     -> 你（或 Muse）取线上页，逐字确认真的出现了
```

三个关键取舍：

- **凭据永远不进 Muse。** Worker 只回给 Muse 一个布尔和回执（提交 SHA、部署 URL）。
  被偷的 Muse token 的最坏后果是"往这一个仓库写内容"，不是"接管你全部仓库"。
- **绝不用本机 `gh` 的 token 当 Muse 通道。** `gh auth status` 实测 scopes 为
  `gist, read:org, repo, workflow`——`repo` 意味着**账号下全部仓库可写**，交出去等于交出整个 GitHub。
  这就是 §5 安全红线里最硬的一条（`docs/CONTRACT.md`）。
- **新仓库，不动原仓库。** 你说得很明确。落地为 `smartlotus/lotus-muse-site`（私有，2026-11-06 新建）
  与 Pages 项目 `lotus-muse-site`（同域 `lotus-muse-site.pages.dev`）。
  `lotussblog`、`lotussmindstream` 及其本地副本**一个字节都不改**。

## 4. 代价与限制（不粉饰）

1. **内容形态变了。** 老博客是手写的静态页面；新仓库要求"内容即数据"
   （`content/entries/0007.json` → 构建出 `site/entries/0007.html`），否则 Muse 每次要改的不是一篇文章
   而是一堆 HTML，必然写坏。代价是：新站点与 `lotussblog` 不共享模板与目录，
   要在主站首页挂上新站入口，就必须动 `lotussblog` ——**本轮按你的要求不做**，
   入口先由新站自己出，主站集成留作你点头后的下一步。
2. **要新建两处云资源**（已建）：Worker + Pages 项目。多了一个会过期的细粒度 PAT 需要轮换，
   以及一条"部署失败怎么看"的运维线。
3. **Muse 会犯错的面积变大了。** 它替你说"我部署好了"是不可信的；所以接口必须返回可核对的
   部署 URL，且 skill 文档里写死"写完必须取线上页确认，HTTP 200 本身不算完成"。
   这条也写进了回滚：每次写操作前把 `content/` 整树快照到 `backups/`，一条命令可回滚。
4. **依赖你的三个一次性动作**（做完就基本不用再管）：
   建一把细粒度 PAT（设置已给死）、把 Worker 的 Muse token 填进 Muse 的安全密钥入口、
   （可选）给 Cloudflare 的 Pages Git 绑定改为直传所需的 API Token 权限确认。
5. **老数据的迁移不在本轮**。`lotussblog` 里已有文章若要变成 `content/entries/*.json`，
   需要一次单独解析（标题/日期/图片路径口径），我会把它列成下一步而不是悄悄混进这次交付。

## 5. 判断

- 想法本身：**可行且方向正确**——你不是在要求一个不存在的"Agent 直接运维我的仓库"能力，
  而是在要求一个"我的系统暴露一个可托管的写接口"，这恰好是 Muse 自定义连接器唯一支持的形状，
  而且你 10 月已经用同一个形状成功过一次。
- 实现方式：**必须是我们自建 Worker 做那只有特权的手**，Muse 只持一把入口 token。
  把 GitHub 或 Cloudflare 的凭据交给 Muse 的方案不可行也不该做。
- 交付边界：本轮交付可运行的仓库、模板、CLI、Worker、Muse 交付包与文档，并做到
  "线上真实可访问 + 接口真实可调用 + 测试真实可红"。
  最后一寸（Muse 那边真按键）需要一个人类动作：建 PAT 与在 Muse 安全入口填 token——
  这不是能力缺口，是**授权边界**，我不替你做。
