# P3.1：自进化 Telegram 注意力桥证据

> 状态：`implemented`。自动化边界、真实 DSH 装配和打包生命周期已验证；真实 Bot、移动端与多日
> soak 尚未验证，因此不是 production-ready，也不宣称已全面上位 Hermes。

## 用户结果

`dsh-evolve` 在后台产生需要处理的 Candidate 或 Evaluator Draft 后，用户不再必须反复查询
`/evolve status`。`dsh-evolve-telegram` 将一个有界、可复制命令的提醒发送到已经静态授权的 Telegram
私聊；原 Session 不等待，所有审批、资格验证和晋升仍走既有 `/evolve` 权威命令。

## 实现边界

- 只桥接既有 `dsh-evolve` control service 与 `dsh-telegram` exact route；
- 复用 supervisor 完成事件并在加载时补扫一次，不建 timer、queue、daemon 或通用 Gateway；
- 每次重读权威 overview，不保存第二份 Evolution 状态；
- Candidate 仅提醒 `pending review` 和 `auto-approved but inactive promotion`；
- Evaluator Draft 仅提醒 `uncertain`、`draft-ready`、`incomplete`；
- 消息只含类型、安全截断后的 Skill 名、状态或建议、exact id 和 inspection command；
- 不含 Prompt、反馈正文、claim、路径、diff、凭证或模型输出；
- 通知不是 Approval，不提供 inline approve/promote/qualify；
- 0 Tool、0 Skill、0 Prompt、0 Command、0 模型调用、普通 Session 0 额外 token。

## 自动化证据

| 证据 | 当前结果 |
|---|---|
| 投影与桥接单元测试 | `dsh-evolve-telegram` 4 个测试文件、16 个测试通过；覆盖状态筛选、有界文案、确定性 id、串行扫描、失败隔离 |
| 真实 Evolution 事件 | 固定 DSH Storage/Jobs 装配下，既有 supervisor scan settle 后发出一次 host-only signal |
| 真实 Telegram route | 固定 DSH Agent/Loader 与假的 Telegram HTTP 边界下，notice 入 durable journal、完成一次发送，重复 id 不再发送 |
| 跨重启去重 | notice 与普通 turn 共用持久 delivery journal；终态重载后仍复用同一条记录 |
| 发送不确定性 | `sending` 恢复为 `uncertain`，不盲目重发；只有显式 `429 + retry_after` 有界重试 |
| KV Cache | native、只装 Telegram、再装 attention bridge 的完整模型请求序列化 byte-equivalent，且请求中无 Telegram/Evolve 动态内容 |
| 包边界 | 从 packed tarball 执行 add、dump-config、boot、catch-up notice、remove；卸载后 profile 无残留插件行 |

## 已知限制

1. 测试使用本地可控 Bot API 边界，不替代真实 Telegram Bot/公网/移动端故障演练。
2. Telegram `sendMessage` 没有调用方幂等键；crash-in-send 只能保守标记 `uncertain`，无法证明对端一定未收。
3. 当前只有一个 exact private chat/user，不支持多收件人、摘要、升级通知或其他渠道。
4. Suite 内部 route 是具体依赖，不承诺公共通知 SPI；至少两个真实独立 Adapter 出现前不抽象。
5. 自动提醒只减少轮询，不代表 Candidate 正确，也不会改变人工保护动作边界。

## 声明口径

可以声明：P3.1 最小注意力闭环已经实现，且没有破坏 DSH KV Cache 优势。

不能声明：真实 Telegram 生产可靠、所有消息/日程场景已覆盖、或已在完整范围上位 Hermes。升级声明前
仍需真实 Bot 多日 soak、陌生安装、移动端恢复测试和同任务 Hermes paired benchmark。
