// 由 scripts/make-fallback.mjs 生成，不要手改。
export const GENERATED_AT = "2026-11-06T10:07:49.989Z";

export const STATE = {
  "site": {
    "schema_version": 1,
    "site_id": "7f3a9c1e2b4d5f6a8c0e1d3f5a7b9c0d",
    "name": "lotus 日志",
    "slug": "lotus-muse-site",
    "subtitle": "由 Muse 维护的个人记录",
    "sort_direction": "newest_first",
    "next_sequence": 4,
    "base_url": "https://lotus-muse-site.pages.dev",
    "created_at": "2026-11-06T07:38:00.000Z",
    "updated_at": "2026-11-06T09:12:43Z"
  },
  "entries": [
    {
      "schema_version": 1,
      "id": "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
      "sequence": 1,
      "date": "2026.11.6",
      "time_label": "",
      "title": "把站点交给 Muse 维护的第一天",
      "body": "从今天起，这个站点的日常维护不再需要我手动改 HTML。加一条记录、上一个新网页、改一段文字，都可以直接对 Muse 说一句话。\n\n背后其实是三件事：内容以 JSON 存在仓库里；构建器把内容渲染成静态页面；接口在收到指令后先提交仓库、再部署到 Pages。任何一步失败都会明确报错，不会让线上和仓库悄悄分叉。\n\n写操作之前会先把整个 content 目录快照到 backups，序号一经分配就不再改变，删掉也不回收。出问题时可以整树回滚，也可以只回滚某一条。",
      "images": [],
      "tags": [
        "站点维护",
        "Muse"
      ],
      "created_at": "2026-11-06T07:38:00.000Z",
      "updated_at": "2026-11-06T07:38:00.000Z",
      "source": "local",
      "author": "lotus"
    },
    {
      "schema_version": 1,
      "id": "b7d3016ea4c85f92d10b73ae64c9f085",
      "sequence": 2,
      "date": "2026.11.8",
      "time_label": "深夜",
      "title": "傍晚下雨，回家把桌子清空了",
      "body": "走到路口的时候开始下雨，没带伞，索性把脚步放慢，一路走到小区门口。外套湿了一层，倒是那种凉意把一整天攒下来的烦躁压掉了不少。\n\n回来把桌上的东西全部清走，只剩键盘和一盏灯。前几天的笔记还没整理，今晚不想再学新东西，就把上周抄的那几段代码重看了一遍。发现自己写的注释全是留给三天后的自己看的，语气客气得像在给陌生人写信：“这里先取第二个字段，因为接口还没改。”\n\n睡前在纸上下了明天的三件事：交一份表格、把站点备份跑一次、给那块旧硬盘找个盒子。写下来之后人就松了，不用在脑子里反复排练同一份清单。明天见。",
      "images": [],
      "tags": [
        "日常"
      ],
      "created_at": "2026-11-08T14:05:00Z",
      "updated_at": "2026-11-08T14:05:00Z",
      "source": "muse",
      "author": "lotus-muse-bot"
    },
    {
      "schema_version": 1,
      "id": "db70af37e82509ecf79e14dcbcd3d971",
      "sequence": 3,
      "date": "2026.11.6",
      "time_label": "下午",
      "title": "命令行写入的一条记录",
      "body": "这一条是用本机命令行写入的，用来验证同一套内容模型在\"没有 Worker、没有 Muse\"的路径上也能走通：\n写入前先快照，序号自动接续，构建产物与数据一起变更。\n\n命令行与 Worker 走的是同一份 lib，所以两条路产生的结果可以逐字节对比。\n",
      "images": [],
      "tags": [
        "验证",
        "命令行"
      ],
      "created_at": "2026-11-06T09:12:43Z",
      "updated_at": "2026-11-06T09:12:43Z",
      "source": "local",
      "author": "lotus"
    }
  ],
  "pages": [
    {
      "schema_version": 1,
      "id": "9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a43",
      "slug": "welcome",
      "title": "关于这个站点",
      "subtitle": "新的记录从这里开始",
      "body": "这里是 lotus 的个人记录。旧的内容仍在原仓库里，新的一切从这里开始。\n\n这个仓库的设计目标是：让日常维护可以被交出去。内容是一份份 JSON，页面由构建器生成，改动先提交仓库再部署线上，所以每一次变更都留下可核对的提交记录，也随时可以回滚。",
      "template": "article",
      "images": [],
      "nav": true,
      "created_at": "2026-11-06T07:38:00.000Z",
      "updated_at": "2026-11-06T07:38:00.000Z",
      "source": "local",
      "author": "lotus"
    }
  ],
  "journal": [
    {
      "ts": "2026-11-06T13:20:00Z",
      "actor": "local",
      "action": "entry.create",
      "target": "0001",
      "commit_sha": null,
      "backup": null,
      "ok": true,
      "note": "初始迁移：第一条记录写清新仓库与 Muse 维护方式"
    },
    {
      "ts": "2026-11-08T14:05:00Z",
      "actor": "muse",
      "action": "entry.create",
      "target": "0002",
      "commit_sha": null,
      "backup": null,
      "ok": true,
      "note": "日常记录一条：傍晚下雨、清桌"
    },
    {
      "ts": null,
      "actor": "local",
      "action": "restore",
      "target": "backups/2026-11-06T07-40-59Z",
      "commit_sha": null,
      "backup": "backups/2026-11-06T07-42-11Z",
      "ok": true,
      "note": null
    },
    {
      "ts": "2026-11-06T07:52:07Z",
      "actor": "local",
      "action": "restore",
      "target": "backups/2026-11-06T07-47-35Z",
      "commit_sha": null,
      "backup": "backups/2026-11-06T07-52-06Z",
      "ok": true,
      "note": null
    },
    {
      "ts": "2026-11-06T09:12:43Z",
      "actor": "local",
      "action": "entry.create",
      "target": "0003",
      "commit_sha": null,
      "backup": "backups/2026-11-06T09-12-43Z",
      "ok": true,
      "note": "本机 e2e"
    },
    {
      "ts": "2026-11-06T09:13:29Z",
      "actor": "local",
      "action": "restore",
      "target": "backups/2026-11-06T09-13-26Z",
      "commit_sha": null,
      "backup": "backups/2026-11-06T09-13-29Z",
      "ok": true,
      "note": "回滚往返 B"
    }
  ],
  "fallback": true
};

export async function fallbackState() {
  if (!STATE.site) {
    throw Object.assign(new Error("dry-run 快照为空，请运行 node scripts/make-fallback.mjs"), {
      code: "not_found",
    });
  }
  return STATE;
}
