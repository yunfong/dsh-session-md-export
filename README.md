# dsh-session-md-export

把 DeepSeek Harness 的会话**一键导出成可读的 Markdown**。

> One-click export of a DeepSeek Harness session as a readable Markdown file — dialogue only, no tool noise.

[![npm](https://img.shields.io/npm/v/dsh-session-md-export)](https://www.npmjs.com/package/dsh-session-md-export)
[![license](https://img.shields.io/npm/l/dsh-session-md-export)](./LICENSE)

## 它解决什么

DSH 内置的 `/export` 下载的是**会话日志 ZIP**（原始 JSONL + 附件），面向备份和排障，人读不了。

这个插件补的是另一条腿：你要的是**能直接读、能贴进 Obsidian/Notion/飞书、能喂给另一个模型**的那份 Markdown。所以它只保留对话本身，把所有工具调用、工具输出、思考过程、系统提示都丢掉。

## 安装

```bash
dsh plugin --profile desktop add dsh-session-md-export
```

或在 DSH 里「插件 → 添加插件」输入包名 `dsh-session-md-export`，重启后生效。

## 使用

两种方式，行为完全一样：

- **会话头部按钮**：会话标题栏最右侧的下载图标，点一次直接下载。
- **命令**：在输入框敲 `/md`。

文件名是 `<会话标题>-<yyyyMMdd-HHmm>.md`，中文标题走 RFC 5987 编码，不会乱码。

## 导出内容

| 保留 | 丢弃 |
| --- | --- |
| 用户消息正文 | 工具调用与工具结果 |
| 助手正文 | 思考过程（reasoning） |
| `ask_user_question` 的问答 | 系统提示、注入的运行时上下文 |
| 压缩点标记 | 命令、任务、重试等日志事件 |

`ask_user_question` 是唯一的例外：它的回答只存在工具结果里，但那是**用户说的话**，丢掉会让记录失真，所以按「问题短标签：答案」还原成用户发言。

## 输出示例

```markdown
# 帮我把这个会话导出成 Markdown。

> session-fixture · 2025-10-21 06:40

**👤 用户**

帮我把这个会话导出成 Markdown。

**🤖 助手**

先看看当前会话的日志结构。

结构清楚了，直接渲染就行。

**👤 用户**

格式：Markdown
还有什么要补充的？：越简单越好
```

完整示例见 [docs/sample.md](docs/sample.md)。

设计取舍（为什么没有 frontmatter、为什么不给工具摘要、为什么不做 full 档）见 [docs/design.md](docs/design.md)。

## 两条提醒

- **issue 里请勿附带真实会话的导出文件或日志**，复现问题用合成数据即可。
- **导出的 Markdown 忠实保留你在会话里输入过的全部内容**（可能含密钥、内部信息），对外分享前请自查。

## 兼容性

- 需要 DSH `>=0.2.1-rc.3 <0.3.0`。
- 只在 Web 界面提供按钮；命令与下载路由同样只在 Web 载体上注册。

## 开发

```bash
npm test
```

测试是自包含的：`test/fixture.jsonl` 是一份合成会话日志，不依赖本机任何会话，覆盖渲染、边界情况和路由装配。

## 许可证

[MIT](./LICENSE)
