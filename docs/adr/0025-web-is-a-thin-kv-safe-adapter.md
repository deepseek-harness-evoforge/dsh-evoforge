# ADR-0025：Web 是 `dsh-evolve` 的薄型、KV-safe Adapter

- 状态：superseded by [ADR-0099](0099-control-center-owns-one-native-view-and-child-surface-slot.md)
- 日期：2026-08-16

## 背景

`dsh-evolve` 已有 Commands 人工闭环，但普通用户仍需记忆命令、复制完整哈希，并在长文本中识别审查状态。交互缺口是真实产品问题；新建 Mission、Control Center、第二套状态库或把演化状态写入 Session 都会扩大概念数量，并破坏 DSH 的缓存稳定性。

## 决策

新增独立、可卸载的 `dsh-evolve-web` 包。以下内容记录当时的设计；后续由 ADR-0099 将 Client Surface
迁入统一的原生 Control Center，因此本 ADR 不再是当前 Web 入口规范。它当时只包含两个 Adapter：

1. `dsh-evolve` Host 内的结构化 Remote Adapter；
2. DSH 原生 Web Client Module，在 root-scoped `sidebar.footer.action` 注册一个演化面板；没有会话时仍可查看和控制 host 状态。

Commands 与 Web 委托同一组权威 owner。Web 通过一个 `EvolutionControlPlane` 深模块获得结构化表面；该模块直接读取现有 `EvolutionStore`、`ReviewInbox`、`CandidatePublisher`、`ResidentEvolutionControl`、Delivery Outcome 与 Feedback Signal，不复制权威状态。Commands 保持已有的人类可读适配层，避免为追求形式复用而重写稳定路径。

Remote 只投影 UI 必需的有界数据：活动 Generation、resident 状态、聚合统计、最多 20 条可处理审查、最多 20 条已批准未激活 Generation，以及单条审查的 bounded diff。后者使 approve 与 promote 之间发生页面刷新或进程重启时仍能继续，而不建立第二状态库。它不返回 `outputDir`、完整 proposal 对象、私有反馈正文、Prompt、cwd 或 Session 消息。

Web 面板只在用户打开时读取，并在显式刷新或动作后重读；没有后台轮询。显式刷新会同时重读当前打开的
review/evaluator detail，权威对象已变化时清除陈旧表单。批准只发布 inactive Generation，晋升是第二个
显式动作。暂停、恢复、拒绝、批准、晋升和回滚都保留原有 durable/rollback 语义。

P1.20 允许 Review Inbox 在同一 Remote 上投影 P1.19 的 exact 自动审阅窗口和唯一触发语义。该字段由
host 的既有证据与 policy 派生，不是浏览器倒计时或第二份状态；Remote 方法与动作集合不变。

## KV Cache 契约

- 不新增 Tool、Prompt、Skill、System Message 或 Session Event；
- 不改变普通 Agent 请求的工具表、消息前缀或会话 composition；
- Web/Remote 运行在 host/client 控制面，模型 Token 增量为 0；
- Client Module 未安装时，`dsh-evolve` 的模型与会话表面完全不变；
- UI 状态不镜像到 Session，不参与 compaction 或 continuation。

## 拒绝的方案

- **解析 `/evolve` 文本输出**：重复面向人的格式，接口脆弱。
- **把状态投影进 Session**：会污染模型上下文并降低缓存命中率。
- **独立 Control Center 服务或数据库**：制造第二权威、部署负担和一致性问题。
- **默认后台轮询**：没有产品必要性；打开时读取与动作后刷新已覆盖当前交互。
- **批准即晋升**：把可审查的 publication 与 future-session activation 合并，削弱回滚边界。

## 后果

收益是零模型 Token 的可发现交互、Commands/Web 行为一致、无会话时仍可访问、插件可单独安装卸载。首版不提供实时推送；只有真实用户证据证明需要时，才考虑事件推送。
