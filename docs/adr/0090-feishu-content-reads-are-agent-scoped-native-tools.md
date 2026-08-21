# ADR-0090：飞书内容读取是 Agent-scoped 原生 Tool，不进入 Gateway

- 状态：accepted
- 日期：2026-08-21
- 关联：[ADR-0049](0049-channel-adapters-share-one-thin-dsh-gateway.md)、[ADR-0089](0089-feishu-approval-actions-bind-the-exact-card-and-route.md)
- 固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`

## 背景

飞书文档、知识库、云盘元数据和多维表格是模型按当前 Goal/材料主动读取的内容资源，不是外部消息路由。
如果把它们放进 `dsh-gateway`，Gateway 就必须理解业务 API、内容权限和模型工具调用，最终变成巨型业务平台。
如果另建 Session、审批或内容仓库，又会复制 DSH 已有权威。

同时，单一“飞书内容访问”开关会把四类权限捆绑，无法最小授权；配置热变更若直接改变当前 Session 的
Tool schema，还会破坏 request-header/cache 一致性。

## 决策

1. `dsh-feishu` 在 routes mode 中提供一个稳定的 Agent-scoped 原生 Tool：`feishu_content_read`。Gateway
   继续只负责 endpoint、Workspace/Session/Agent、入站和普通文本投递，不增加内容 API、token 或审批状态。
2. 部署权限拆为 `document-read`、`wiki-read`、`drive-metadata-read`、`bitable-records-read`，全部默认关闭。
   平台 App scope 和资源成员权限仍是更窄的第二道外部门禁；pairing mode 禁止启用内容权限。
3. 每次允许的读取都返回 DSH 原生 `ask` 决策，由 `ApprovalService` 写入配对的
   `approval/asked`/`approval/decided`。Approval 服务缺失时 ToolRuntime 原生 fail closed；权限关闭还会被
   pre-execute、单调 guard 和 executor 三处复核，任何一处都不能触碰平台 API。
4. Tool 只接受 exact token 或官方 Feishu/Lark HTTPS URL，按 resource kind 解析；调用展示和结果不回显输入
   resource token、provider metadata URL 或 owner/user identity。文档返回有界 raw text；Wiki 只在节点对象为 docx 时读取底层正文；
   Drive 只返回有界元数据；Bitable 可返回一页有界 record fields。所有 HTTP 调用继承 Tool AbortSignal。
5. 当前 Session 若尚无 request header，按当前部署权限决定是否安装 Tool；已有 header 时，仅当旧 header
   已包含该 Tool 才重装。权限撤销不会让旧 Session schema 漂移，但 executor 会拒绝；新启用能力只进入
   未来 Session。
6. 结果只作为 DSH 原生 durable `tool/result` 进入 Session，不另建内容 Store、索引、缓存、Agent Runtime
   或权限体系。runtime/Agent dispose 会注销 Tool；内容配置不增加 Gateway route 或运行时外部 Skill 获取。

## 后果

- 四类平台能力可以独立最小授权，模型无需开场让用户选择路径，仍可在自然 Goal 中按需调用。
- schema、Approval、Session durability 和 Agent scope 继续由 DSH 权威实现；插件只保留飞书协议映射。
- assembled fake transport 可以证明 DSH 组合与权限门，但不能替代真实飞书 App scope、资源权限拒绝、真实
  内容、真实用户审批、长期运行或 Hermes paired benchmark。
