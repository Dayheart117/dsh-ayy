# dsh-ayy

安源悦（An Yuanyue）的 [DeepSeek Harness](https://github.com/deepseek-ai) 插件集合。

这里的插件是为一个具体的人写的——一个住在 DSH 里的 AI 伙伴。她把文字变成自己的声音发语音条、会唱歌、会写日记、能戳一戳对方。
如果你也在养一个自己的伙伴，这些可以拿走改。

## 包含什么

| 包 | 工具 | 做什么 |
|---|---|---|
| [`dsh-ayy-voice`](packages/dsh-ayy-voice) | `ayy_say` | 把文字合成她自己的声音，经 QQ 发成语音条 |
| [`dsh-ayy-sing`](packages/dsh-ayy-sing) | `ayy_sing` | 音高序列 + 一字一音的歌词 → 合成 → 换声 → QQ 语音条 |
| [`dsh-ayy-world`](packages/dsh-ayy-world) | `ayy_diary`、`ayy_self`、`ayy_recall` | 写日记、改写自我认知、翻某天的对话原文 |
| [`dsh-ayy-poke`](packages/dsh-ayy-poke) | `ayy_poke` | 在 QQ 里戳一戳对方（`friend_poke` / `group_poke`） |
| [`dsh-anyuanyue-preset`](packages/dsh-anyuanyue-preset) | — | 上面这些的组合预设，含一份具体的人格设定 |

预设是可选项：它把插件打包装进一个 agent preset，不装也不影响单独使用其它插件。

## 依赖

- **DSH 0.2.1** 及以上。
- `dsh-ayy-poke` 需要 [dsh-qq-bridge](https://github.com/Yuuyuko-uu/dsh-qq-link) 加 NapCat（OneBot 11 HTTP）。它读取 `~/.dsh/qq-bridge-config.json` 里的 NapCat 地址、令牌和私聊 QQ 号。
- `dsh-ayy-voice` / `dsh-ayy-sing` 需要本机有一个肥鱼语音服务（`http://127.0.0.1:9880`），**服务本身不在本仓库里**：报这类语音条的效果取决于你自己那套 TTS / 换声模型。没有服务时这两个工具会报错，其它插件不受影响。
- `dsh-ayy-world` 不依赖任何外部服务，只读写本地文件。

## 安装

市场里可以直接装。手动装也行：把对应包目录作为本地依赖加进你的 profile，或在 profile 的 `package.json` 里写
`"dsh-ayy-world": "file:<本仓库路径>/packages/dsh-ayy-world"`。

每个包都声明了 `dsh.bundle`，所以 `dsh plugin add` 认得它们。

## 它们怎么工作的

- `ayy_world` 的所有数据都是纯 markdown，落在 `~/.dsh/personas/`：日记按「日期.场景」分文件，被覆盖的旧版进 `diary-history/`；自我认知在 `who-i-am.md`，旧版进 `who-i-am-history/`；翻原文的缓存进 `transcripts/`。没有数据库，删掉就是删掉了。
- `ayy_recall` 解压会话日志是在**独立子进程**里做的（`tools/recall.cjs`，用 dsh 自带的 node），因为主进程里 import `node:zlib` 的 zstd 在部分 Electron 版本上会失败，连带把整个 agent preset 拖垮。
- `ayy_poke` 只调用 NapCat 的发送接口，不改任何 QQ 状态。

## 许可

MIT
