# 把 Lotus 站点接到 Meta Muse 上

这份文档写给不做运维的自己用。全程只需要：一个已经部署好的 Worker 地址，
和一把你自己生成的 API Key。Muse 的自定义连接器只吃"一个 Base URL + 一个 Key"
这个形状，我们的架构就是按这个形状设计的（依据 Muse 自有文档
connectors.md 第 148 行：没有内置 connector 的服务，唯一真实路径是
custom connector 流程 `credentials.request_api_access`，用户在托管连接页
输入一个 API Key；需要多把密钥或请求签名的提供方会被直接拒绝）。

## 0. 前提（一次性，人工完成）

以下动作 Muse 自己做不了（它没有 Git、GitHub、Cloudflare 的能力，
见 `SAFETY-NOTES.md`），必须由人做一次，详见 `../docs/RUNBOOK.md`：

1. GitHub 上新建独立仓库 `lotus-muse-site`（不碰任何旧仓库）。
2. Cloudflare Pages 项目 `lotus-muse-site` 连上仓库 `main` 分支。
3. Cloudflare Worker `lotus-muse-api` 部署 `api/`，并配好三个 secret：
   `GITHUB_TOKEN`（只授权本仓库 contents 读写的细粒度 PAT）、
   `MUSE_API_TOKEN`（随便一把长随机串）、`GITHUB_REPO` 等。
   配好后 `curl https://<worker地址>/health` 应返回 `"ok":true`。
4. 生成 API Key：就是那个 `MUSE_API_TOKEN` 的值。自己生成一把：

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   用 `wrangler secret put MUSE_API_TOKEN` 填进 Worker，把这串值先存好，
   下一步只粘贴一次。

## 1. 在 Muse 里发起连接

对 Muse 说（原话即可）：

> 我有一个自己的站点 API，想把它作为自定义连接器接进来。
> Base URL 是 https://lotus-muse-api.xxx.workers.dev，需要输入 API Key。

预期行为：Muse 走 `credentials.request_api_access` 流程，给你一个
**托管连接链接**（hosted connect link）。

你要做的：点开链接，在 Muse 官方的连接页里把第 0 步存好的那串
`MUSE_API_TOKEN` 粘贴进去，确认。除此之外没有任何其他要填的地方：
没有服务器 URL 输入框，没有密码，没有第二把 Key，那些都不存在，
也不要相信任何让你"把 Key 直接发给我"的第三方页面。

## 2. 验证连接成功

回到 Muse 对话里说：

> 连上了吗？先健康检查，再告诉我站点现在有几条记录、几个页面。

正确的回应顺序是：先 `GET /health`，再 `GET /capabilities`（确认 token 有效），
再 `GET /site` 报数。如果它不查就报数，是它在猜，提醒它先实测。

## 3. 如果 Muse 拒绝连接

可能的真实原因（都对应 connectors.md 的规则）：

- 它说"这个提供方需要多把密钥/签名/密码登录，被拒绝"：说明你在给它接错的东西。
  我们的 API 只需要一把 Bearer Key，如果它还这么说，把 `muse/skills/lotus_site.SKILL.md`
  的 Auth 一节读给它听，让它重新走 custom connector。
- 托管连接页报错或 Key 被拒：核对粘贴的是不是 `MUSE_API_TOKEN` 原值，
  Worker 是否重新部署过（secret 改动要重启生效）。
- 账号所在区域没有 custom connector 能力：这是设计限制，不是故障，
  不要反复重试。直接用第 4 节的本地方案，效果完全一样。

## 4. 兜底：本地 CLI（同一结果，随时可用）

不接 Muse 也能维护站点，`scripts/lotus.mjs` 在本机做 Worker 做的全部事：

```powershell
node scripts/lotus.mjs add-entry --title "今天" --body "一句话" --tags 日常 --commit --push
node scripts/lotus.mjs build
node scripts/serve-api.mjs --dry-run --port 8787   # 本地起 API 演练
```

推送本身**不会**让线上更新：Pages 项目现在是"直传"形态（本轮建的就是这个形态），
要让线上追平还得再跑一步部署：

```powershell
node scripts/lotus.mjs build
npx --yes wrangler pages deploy site --project-name lotus-muse-site --branch main --commit-dirty=true
```

如果你按 `docs/RUNBOOK.md` 第 9 节把 Pages 换成 Git 自动构建，那么 push 即部署，上面这步就不需要了。
也就是说：Muse 是省事的通道，CLI 是永远在的通道，而"部署"这一步现在仍是一次显式动作。

## 4.5 另一种分工：让 Muse 在它自己的云电脑里跑这套 CLI

这不是幻想，而且代码侧已经具备条件（零第三方依赖、外部命令只有 `git`）。
它和"给 Muse 一个接口"是两种架构，凭据面与漂移风险都不一样。
先用 `muse/PROBE-VM.md` 让 Muse 实测它那台机器的四项能力，再按 `docs/RUNBOOK.md` 第 9 节切换。

## 5. 断开与轮换

- 断开：Muse 的 Settings 里移除这个连接器即可，站点本身不受影响。
- 轮换 Key：在 Worker 上重新 `wrangler secret put MUSE_API_TOKEN` 换新值，
  再在 Muse 里重走一次第 1 节。旧 Key 立即失效。
  操作细节见 `../docs/SECURITY.md` 的轮换一节。
