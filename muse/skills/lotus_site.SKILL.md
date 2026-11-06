---
name: "lotus_site"
description: "Maintain the Lotus personal site (journal entries, standalone pages, republish, restore) through its JSON HTTP API."
metadata: { "includeInPrompt": false }
---

# Lotus 站点

## Purpose

通过 `lotus_site` 连接器维护 lotus 的个人站点：加一条记录、上一个新网页、改一篇、
删一篇、重新发布、从快照恢复。站点源数据在 GitHub 仓库 `lotus-muse-site`，
公开地址是 Cloudflare Pages 域名。所有读写都走这一个 HTTPS JSON API，
没有其他命令，也没有直接操作 Git、GitHub 或 Cloudflare 的能力。

## Tooling

所有路径都相对于连接器绑定的 Base URL（形如
`https://lotus-muse-api.<account-subdomain>.workers.dev`）。
写请求必须带 `Authorization: Bearer <连接器持有的 API Key>`。
一切响应 `Content-Type: application/json`，形状恒为 `{ "ok": boolean, ... }`；
失败为 `{"ok":false,"error":{"code":"…","message":"…"}}`。

接口清单（与 docs/CONTRACT.md 第 4 节逐字一致）：

读接口（无需鉴权）：
- `GET /health` -> `{ok, mode:"live"|"dry-run", repo, base_url, counts}`
- `GET /site` -> 站点清单 + 统计（含 `next_sequence` 与 `base_url`）
- `GET /entries` -> 记录列表（不含 body）
- `GET /entries/:seq` -> 单条全文，`:seq` 为 4 位零填充序号，如 `0007`
- `GET /pages` -> 页面列表
- `GET /journal?limit=20` -> 最近操作流水

写接口（需 Bearer）：
- `POST /entries`，请求体字段：
  `{"date":"2026.11.6","time_label":"","title":"","body":"…","tags":[],`
  `"images":[{"path":"media/x.png","base64":"…","alt":"…"}],`
  `"note":"给 journal 的说明","expect_sequence":7}`
  `images[].path` 指仓库内已有文件；`base64` 表示要新建的媒体，
  写入 `media/<日期目录>/<basename>`，单文件上限 5 MiB，总量上限 10 MiB。
- `PUT /entries/:seq` 改一条记录（全量替换可改字段）
- `DELETE /entries/:seq` 删一条记录
- `POST /pages` 新建网页：`{"slug","title","subtitle","body","template":"article|blank|gallery","nav":true,"note","expect_sequence"}`
- `PUT /pages/:slug` 改网页；`DELETE /pages/:slug` 删网页
- `POST /actions/republish` 内容不变，重建并提交一次以触发 Pages 重新部署
- `POST /actions/restore` 请求体 `{"backup":"backups/<快照目录>"}` 整树恢复
- `POST /actions/rollback-entry` 请求体 `{"sequence":7,"backup":"backups/<快照目录>"}` 只回滚一条
- `GET /capabilities`（需 Bearer）->
  `{ok, scopes:["read","entry.write","page.write","site.republish","site.restore"], token_valid:true, identity:"muse"}`

写响应形状（POST /entries 为例）：
`{"ok":true,"mode":"live","entry":{…},"commit_sha":"…","commit_url":"…",`
`"changed_files":[…],"journal":{…},`
`"deploy":{"hint":"Pages 自动构建","url":"https://…/entries/0007.html"}}`
`mode:"dry-run"` 表示 Worker 未配置 GitHub 写入凭据，不写仓库，
额外返回 `planned_files:[{path,content}]`；dry-run 不是失败，但也没有真正生效。

错误码（`error.code`）：
`unauthorized`(401) `forbidden`(403) `not_found`(404) `method_not_allowed`(405)
`invalid_input`(400，带 `details.errors`) `unsafe_path`(400) `too_large`(413)
`conflict_sequence`(409，`expect_sequence` 与实际不符) `github_unauthenticated`(503)
`github_failed`(502) `internal`(500)。
收到 `conflict_sequence` 或 `github_failed` 时：重新 `GET /site` 取最新序号后最多重试一次，
不要盲目循环。

以上之外的路径、字段、命令一律不存在。

## Auth

- 本连接器是自定义连接器：连接时由用户在托管连接页输入这一个 API Key，
  由连接器保管，你永远不需要也不应该向用户索要、复述或打印这个 Key。
- 每个回合第一次动这个站点前，先 `GET /health` 确认服务可达；
  写操作前再 `GET /capabilities` 确认 token 有效与实际 scopes。
  连接状态只看本回合的实测结果，绝不凭记忆或凭上一回合的结果断言"已连接"。
- 任何一次调用返回 401 / `unauthorized`：立即重新 `GET /capabilities` 核实；
  若仍失败，如实告诉用户"连接失效或权限不足，需要重新连接或检查 Worker 配置"，
  不要改用其他通道，不要重试写操作。
- 永远不要在回复、日志或请求回显里打印 token 值。

## Operating Rules

1. 先读后写：动手前先 `GET /site`、`GET /entries`（或 `/pages`、`/journal`），
   基于实测数据向用户提议，不凭记忆猜站点现状。
2. 任何写操作（增、改、删、republish、restore）之前，必须把要写入的确切
   文字（标题、正文、日期、标签、图片说明）完整展示给用户，征得明确同意后才发请求。
3. `expect_sequence` 必须取自同一回合内新鲜 `GET /site` 返回的 `next_sequence`
   （删除/修改时同理以新鲜读取的列表为准），防止覆盖用户同时在别处的改动。
4. 写请求返回 `ok:true` 还不算完成：必须接着取响应里 `deploy.url`（或
   `base_url + /entries/<seq>.html`）把线上页面抓下来，确认用户要的文字
   真的出现在页面里，才能告诉用户"完成了"。只在站点内确认 API 返回 200
   不等于部署完成；Pages 构建可能有几十秒延迟，取不到就先如实说"已提交，
   线上还在构建"。
5. 删除任何记录或页面前，必须引用确切的对象（序号、日期、标题原文）并向用户
   逐字确认，得到明确的"删"字答复才执行。
6. 本文件没写的命令或端点，回答"这个连接器没有这个能力"，绝不发明。
   例如这里没有：改主题、改域名、管理图片库、批量导入、直接 git 操作。
7. 图片只能来自用户提供的 URL 或用户上传的文件，转成 `images[].base64` 时
   单文件不得超过 5 MiB；超了就告诉用户先压缩，不要截断或伪造。
8. `journal.jsonl` 是只增流水：绝不改写、删行或重排历史记录。
