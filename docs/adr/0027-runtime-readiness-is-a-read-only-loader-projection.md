# ADR-0027：Runtime Readiness 是只读 Loader 投影

- 状态：accepted
- 日期：2026-08-17

## 背景

DSH 已有两类诊断能力：包自有 invariant 发现运行时契约被破坏，Host Plugin Inventory 原样投影当前 Loader entry。前者不是用户就绪检查，后者也不会判断操作者要求的插件是否缺失、禁用、仍在重载或已经失败。用户仍需理解 Loader 内部状态，才能回答“这套组合现在能否工作、下一步应检查什么”。

EvoForge 需要降低安装和常驻运维门槛，但如果为此建立健康数据库、后台探针、修复工作流或第二个守护进程，就会重复 DSH 生命周期权威并增加无必要复杂度。

## 决策

新增独立、可删除的 `dsh-doctor` Bundle。它在用户执行 `/doctor` 时读取一次原生 Loader 当前状态，并把静态配置的 exact required module names 与全部 enabled failure 归约成一个 `Runtime Readiness Report`：

- required module 存在、enabled 且至少一个 entry 为 active，才通过 required check；
- 缺失、禁用或 failed 为 `not-ready`；
- pending、loading、unloading 或无 live fiber 为 `unknown`，避免在热重载窗口误报；
- 任何 enabled failed entry 都单独列出 module name 与 entry id；
- 输出给出有限、可执行的下一步，但不自动修改配置、启停插件或重启进程。

当 exact required module 包含 active 的 `dsh-feishu` 或 `dsh-telegram` 时，同一次命令再读取现有
`evoforge.gateway.healthSnapshot()` 的脱敏 transport facts：无对应 transport 或损坏快照为 `not-ready`，
任一 `degraded` 为 `not-ready`，Gateway ready 且全部对应 transport ready 才通过，connecting/stopping 或
Gateway lifecycle 尚未稳定为 `unknown`。飞书和 Telegram 独立归约；Doctor 不读取平台身份、凭据或错误正文，
也不调用外部平台。

报告不落盘、不轮询、不保留历史。Loader 仍是唯一插件生命周期权威，Gateway 仍是唯一 transport 健康权威，
DSH invariant 仍负责包内契约，Plugin Inventory 仍负责原始状态投影。`dsh-doctor` 只拥有就绪分类与解释。

## KV Cache 契约

插件只注册原生 human Command，不注册 Tool、Prompt、Skill、System Message、Session model surface 或模型调用。Command discovery、输入和输出都留在 host/control plane，因此正常 Agent 请求增加 `0` token，模型可见前缀与 Tool Schema 不变。

## 拒绝的方案

- **复用 invariant 表示用户就绪**：invariant 验证包内事实，不知道操作者要求哪些可选能力。
- **直接展示 Plugin Inventory**：原始状态不足以解释缺失依赖和下一步动作。
- **后台轮询并维护健康历史**：引入第二套状态、定时器和告警语义，首版没有证据需要。
- **Doctor 自行探测飞书/Telegram 或复制 transport registry**：重复 Gateway 权威并扩大凭据、网络和生命周期边界。
- **自动修复、自动 enable 或自动重启**：诊断不应扩大权限或夺取 DSH lifecycle authority。
- **把 Doctor 暴露为模型 Tool**：Agent 正常执行不需要周期性读取 host 健康，且会增加 Tool surface、token 和缓存风险。
