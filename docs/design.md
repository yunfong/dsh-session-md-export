# 设计说明

这份文档记录取舍，方便以后改动时知道哪些是**决定**、哪些只是当时的实现。

## 定位

DSH 内置 `/export` 产出会话日志 ZIP（原始 JSONL + 附件），适合备份和排障，不适合阅读。

本插件只解决可读性：**一份能直接读、能贴进笔记软件、能喂给另一个模型的 Markdown**。两者互补，不重叠。

## 只导对话

剥掉工具调用后，执行型会话里助手的中间叙述会失去所指：

```
**🤖 助手**
现在有两条 VPN 同时在线……继续看 DNS 明细和实际解析测试：

两个域名当前都能解析……继续深挖分流域和匹配域：
```

「继续看 DNS 明细」后面直接就是结论，因为明细在工具结果里。这是"仅对话"的固有代价，不是缺陷。三种弥补方式（每回合一行工具摘要、文件末尾一行"已省略 N 次调用"、保留一个带 `<details>` 的 full 档）都被明确否决了：这份文件的首要目标是**干净**，需要过程就去用 `/export`。

## 唯一的例外：ask_user_question

`ask_user_question` 的回答不是 `user/message` 事件，它只存在于工具结果里：

```json
{"answers":[{"id":"layout","selected":["C 紧凑"]}]}
```

如果按"丢掉所有工具结果"处理，用户的选择会从记录里整段消失——读起来像是模型自己做了所有决定。所以这里按用户发言还原：

```markdown
**👤 用户**

格式：Markdown
还有什么要补充的？：越简单越好
```

标签取 `questions[].header`，没有 header 时退回 `question`；多选以 `、` 连接，自由文本原样保留；每个答案独立成段（单个换行在多数渲染器里会折叠成空格）。

## 版式

`**👤 用户**` / `**🤖 助手**` 平铺，没有轮次标题。

考虑过的另外两种（`## 第 N 轮` 下挂 `### 角色`、`## 角色` 平铺）在 20 轮以上会退化成一条没有章节的长流水或层级过深；粗体角色行贴进 Notion/飞书时层级最轻。

**同一角色连续出现时只写一次标题**：会话里连发三次「重试」，得到的是一段里三行，而不是三个重复标题。

## 元信息

没有 YAML frontmatter——贴进 Notion 会多出一段 `---` 噪音。标题下只留一行：

```markdown
> session-1f3c9a2e-4d5b-4c81-9e77-0a1b2c3d4e5f · 2026-10-15 19:50
```

会话 id 和时间，仅此。轮数、工作目录、模型名都去掉：读的人不需要它们才能读懂对话。

## 数据来源

`ctx.sessionQuery.readSession(id)` —— 一次拿到完整原始事件日志，不依赖客户端分页，也不使用 `readSurface()`（那是压缩后的"当前上下文"，会丢掉用户已经看过的早期内容）。

按日志顺序还原**当时看到的完整对话**，压缩点插一行 `> ⓘ 上下文已压缩：此前的消息已折叠为摘要`。

纳入与排除：

| 纳入 | 排除 |
| --- | --- |
| `user/message`（`source.kind === 'user'`） | `request/header`（单条可达 44 KB 的工具 schema） |
| `assistant/message` 的 text 块 | `request/context`、`system/message`、`developer/message` |
| `ask_user_question` 的问答 | `agent/inbox/spliced`（注入上下文） |
| `compaction/summary` | `llm/retry*`、`job/*`、`session/*`、`turn/*`、`step/*`、`assistant/attempt` |

## 架构

```
Host (index.js)
├─ GET|HEAD /api/session.markdown?sessionId=…   ← 鉴权由 connection 统一处理
├─ /md 命令                                      ← 与按钮走同一条下载路径
└─ render.js：事件折叠 → Markdown（纯函数，无 IO）

Client (client.js)
├─ conversation.session.header.utilities 槽位里一个 28px 按钮
├─ fetch → blob → 按 content-disposition 的文件名下载
└─ 监听 command/executed，把 /md 桥接到同一个下载器
```

导出逻辑只有一份，在 Host；浏览器那半只决定**何时**下载，不决定**下载什么**。

按钮点击与 `/md` 共用同一个下载器，因此两者永远不会给出不同结果。

## 边界情况

| 情况 | 行为 |
| --- | --- |
| 会话没有对话正文（纯工具/纯命令） | 照常生成文件，正文是一行斜体说明并指向 `/export` |
| 会话不存在 | 404，页面显示原因，不产出空文件 |
| 会话仍在运行 | 导出到请求时刻的快照 |
| 中文标题 | 文件名走 RFC 5987，ASCII 兜底名 |
| 只有图片/附件的消息 | 占位文本，不留空标题 |

## 非目标

PDF / HTML / DOCX、批量导出、子会话合并、模板引擎、自定义主题、导入回 DSH。

这些要么是 `/export` 的职责，要么没有明确需求。
