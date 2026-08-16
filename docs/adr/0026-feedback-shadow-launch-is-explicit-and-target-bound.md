# ADR-0026：反馈 Shadow 启动必须显式且绑定静态 Target

- 状态：accepted
- 日期：2026-08-16

## 背景

当前反馈 Signal、私有 Draft、Shadow、review 和 Generation 已各自闭环，但用户必须离开控制面，手工选择 Skill、Case Pack、run root 并拼接 CLI。直接允许浏览器传入路径会扩大文件与执行权限；后台自动触发 proposer 又会在没有本次授权时产生付费请求并外发反馈文本。

## 决策

`dsh-evolve` 增加显式 `Feedback Shadow Launch`，但不增加调度平台。操作者在 host 配置中声明少量 `Shadow Target`：固定 id、Skill、已校准 Case Pack 与现有 supervisor run root。Commands 或 Web 只能提交一个当前 Feedback Signal id 和一个 Target id，不能提供路径、模型地址、Prompt 或任意执行参数。

一次启动先复用原生反馈、Session pin 与 exact Git Skill 校验创建私有内容寻址 Draft，再把现有 `runShadow` 作为无 owner 的原生 `evolution` Job 提交。调用立即返回；原 Session 不等待。run-local journal 继续作为重启权威，Jobs 只提供当前进程观察和取消；`proposal-pending` 的不确定付费请求仍不自动重试。相同 Signal、Target、Case Pack、Skill 与模型 route 得到同一个 launch id，重复操作复用 durable run，不重复创建付费效果。

该动作是 Protected Action：用户在确认框或 host command 中的本次显式调用，同时授权一次可能付费的 proposer 请求，以及把该 Draft 的受限用户文本和纠正发送到已配置 provider。没有显式调用或后续明确部署策略时，Delivery Outcome、Feedback Signal、定时扫描和 resident recovery 都不能自动开始 proposer。

## KV Cache 契约

Shadow Target、Signal、run 状态与 Jobs 都留在 host/control plane；不新增 Tool、Prompt、Skill、System Message 或 Session Event。Web 只接收 bounded id/status 投影，不接收 host path 或反馈正文，普通 Agent 请求与 Session composition 不变。

## 拒绝的方案

- **浏览器提交任意 Skill/Case Pack/output path**：把 host 文件权限变成远程输入。
- **Signal 出现即自动运行**：未经本次授权产生付费和数据外发。
- **新建 durable queue/workflow database**：run journal 与原生 Jobs 已覆盖事实和观察职责。
- **在前台 Session 内反思并等待**：阻塞原任务并污染缓存稳定的模型上下文。
