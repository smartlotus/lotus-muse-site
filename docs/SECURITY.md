# 安全模型

适用于 `docs/CONTRACT.md` 第 5 节的实现；本文解释威胁与理由。

## 威胁模型：泄漏了什么，各能干什么

| 凭据 | 持有者 | 权限范围 | 泄漏后的爆炸半径 |
|---|---|---|---|
| `MUSE_API_TOKEN`（Muse 那把 Key） | Muse 连接器 | 只能调用 Worker 已实现的端点 | 可改写这一个站点的内容（经 Worker，仍是可回滚的 git 提交）；不能碰 GitHub 账号、不能碰 Cloudflare 其他资源 |
| Worker 的 `GITHUB_TOKEN` | 仅 Worker secret | fine-grained PAT：仅 `lotus-muse-site` 一个仓库，仅 contents 读+写 | 可改写这一个仓库；看不到 issue/secret/设置，动不了账号里任何其他仓库 |
| Pages 上传 Token | 仅 Worker secret | 只允许向 `lotus-muse-site` Pages 项目直传产物 | 可替换线上静态产物（与篡改仓库后触发的效果同级），不能改 DNS、不能改 Workers |
| 本机 `gh` 的 `gho_` token | 只存在于这台电脑 | scopes 含 `repo`，即账号全部仓库可读写 | 绝不能进入任何一条网络通道。这就是契约第 5 节第 2 条禁止把它用作 Muse 通道的原因：它的半径是整个账号 |

## 关键设计决定

1. 特权收进 Worker，Muse 只见门票。
   Muse 的连接器形状只容得下"一个 Base URL + 一个 Key"，因此 Worker
   是唯一持特权的一方；这把 Key 甚至不是云凭据，只是一串门票。
2. 单仓库细粒度 PAT 的确切配置（错一项都会扩大半径）：
   Repository access = Only select repositories，勾选 `lotus-muse-site`；
   Permissions 只加 Contents = Read and write。不加 Administration、
   不加 Metadata 以外的任何项、绝不用 classic token。
3. 写路径白名单：Worker 只允许提交到 `content/`、`site/`、`media/`、
   `backups/` 四个前缀，其余一律 `unsafe_path`(400)。`lib/`、`api/`、
   `scripts/`、`docs/`、`package.json` 从 API 侧不可变。即使 Muse 的
   Key 被盗，攻击者也改不了 Worker 自己的代码。
4. 路径消毒：`assertSafeRelPath` 拒绝 `..`、绝对路径、盘符、前导点，
   防目录穿越写出白名单。
5. 鉴权默认拒绝：Worker 未配置 `MUSE_API_TOKEN` 时所有写接口一律 401；
   token 比对用定长摘要（SHA-256 后比长度固定的摘要），不做逐字节
   短路比较。`/health` 与读接口公开，因为站点本身是公开的。
6. 不破坏历史：没有 force push、不改写历史、不删除 `backups/`。
   一切"错误发布"都可以用新提交纠正或用快照恢复。
7. 不回显 secret：Worker 响应与日志只记 action 与结果码；
   `scripts/serve-api.mjs` 启动时只报告凭据"已配置/未配置"。

## 攻击者拿到 Muse 的 Key 之后，仍然能做坏事吗？

能做的是：在 API 限定的形状内改内容（伪造一条记录、删一条记录、改首页
文案），即污染这一个公开站点的文字与图片。这就是"公开页面被涂写"级别
的损失，不涉及账号、其他站点、任何服务器。

缓解（按发现速度从快到慢）：

1. 每次写都有 GitHub 提交（作者 `lotus-muse-bot`），diff 可审、可回滚。
2. `content/journal.jsonl` 只增流水，事后能回答"什么时间改了什么"。
3. `backups/<快照>` 让整树恢复成为一条 API 调用（`POST /actions/restore`），
   也可本地 `node scripts/lotus.mjs restore --backup backups/<快照>`。
4. `scripts/live-verify.mjs` 定期或事后抓线上字节核对。
5. 轮换 Key（见下）立刻掐断该攻击面，旧 Key 不留残余。

## Token 轮换步骤

```powershell
# 1. 生成新门票 Key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 2. 更新 Worker secret（改完立即生效，无需重新部署代码）
npx --yes wrangler secret put MUSE_API_TOKEN
# 3. 在 Muse 的 Settings 移除旧连接器，再按 muse/CONNECT-SETUP.md 重新连接并输入新 Key
# 4. 验证: curl https://<worker>/health 与一次 GET /capabilities
```

GitHub fine-grained PAT 轮换：在 GitHub 上对该仓库重新签发（设定到期日），
`wrangler secret put GITHUB_TOKEN` 更新，旧 PAT 立即撤销。Pages Token 同理
在 Cloudflare 控制台重发。怀疑泄漏时的顺序：先转门票（最快），
再视线索转 Worker 内的两把云凭据。

## 本机 CLI 的安全属性

`scripts/lotus.mjs` 不访问网络、不读取云 secret；`--commit` 只执行
`git add -A && git commit`，绝不 `--no-verify`、绝不 force；`--push`
前检查工作区中四个允许前缀之外是否存在未跟踪文件，存在即拒绝推送，
防止把随手放的敏感文件推上网。
