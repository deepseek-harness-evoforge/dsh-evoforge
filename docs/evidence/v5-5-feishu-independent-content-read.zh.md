# V5.5 飞书独立权限内容读取

> 日期：2026-08-21；固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`；状态：assembled implemented；真实飞书 App 内容与权限门禁 pending

## 本增量交付

按 [ADR-0090](../adr/0090-feishu-content-reads-are-agent-scoped-native-tools.md)，`dsh-feishu` 增加一个
Agent-scoped 原生 `feishu_content_read` Tool，而不是修改 `dsh-gateway` 或创建内容 Gateway。部署者可独立启用：

- `document-read`：文档标题、revision 和有界 raw text；
- `wiki-read`：知识库节点元数据，docx 节点可读取有界底层正文；
- `drive-metadata-read`：云盘 exact object 的标题、类型、时间和安全标签，不返回 URL、token 或 owner；
- `bitable-records-read`：多维表格 App 元数据和可选的一页有界 record fields。

四项默认全部关闭。每次实际读取都先经过 DSH Tool pre-execute/guard 和原生 Approval；配置未授权、审批拒绝、
Agent 不匹配、参数不合法和取消信号均在平台调用前失败。当前 Session 的 schema 以 request header 为准；中途
启用只影响未来 Session，中途撤销保留旧 schema 但调用会被拒绝。

## 自动化证据

- `content-tool.test.ts` 使用真实 `ToolRuntime`、`ApprovalService` 和 `ctx.tools.execute()`，证明配对审计事件、
  独立权限拒绝、审批拒绝、参数门、Agent scope 和 disposer；
- `content-platform.test.ts` 对固定官方 Node SDK 语义测试 document/wiki/drive/bitable 映射、长度/条数边界、
  安全错误和 AbortSignal 进入 Axios 请求；
- `dsh-assembled-content.e2e.test.ts` 通过真实 DSH Boot、Agent Loop、Session persistence、Tool/Approval、Gateway
  与飞书 runtime，只替换外部飞书网络和非确定性模型。审批前平台读取为 0；exact 卡片放行后产生 durable
  `approval/*`、`tool/call`、`tool/result`，模型第二次请求收到内容；两次请求的 Tool schema 完全相同；
  Tool 只属于 exact Agent，runtime dispose 后消失；
- package config/contract 测试证明四权限 allowlist、默认关闭、上限、pairing mode 拒绝内容权限，以及
  `dsh-tools`/`dsh-llm` 仍是 peer 而非内置第二套 runtime。

完整 `dsh-feishu` 回归为 `17/17` test files、`47/47` tests，并通过 typecheck/build。

## 一手协议依据

实现固定 `@larksuiteoapi/node-sdk@1.73.0`，按官方 SDK 的 `client.domain.resource.method` 调用：
[官方 Node SDK](https://github.com/larksuite/node-sdk)、
[Docx raw content](https://open.feishu.cn/api-explorer?from=op_doc_tab&apiName=raw_content&project=docx&resource=document&version=v1)、
[Wiki get node](https://open.feishu.cn/api-explorer?from=op_doc_tab&apiName=get_node&project=wiki&resource=space&version=v2)、
[Drive batch query metadata](https://open.feishu.cn/api-explorer?from=op_doc_tab&apiName=batch_query&project=drive&resource=meta&version=v1)、
[Bitable search records](https://open.feishu.cn/api-explorer?from=op_doc_tab&apiName=search&project=bitable&resource=app.table.record&version=v1)。

## 未完成声明

本证据没有真实飞书 App 凭据，不冒充真实 tenant scope、资源成员权限、真实正文/记录、真实用户审批、限流、
断线重连或多日运行。普通文件、音频、视频仍受固定 DSH attachment v1 限制；真实 exact route 消息和
Hermes paired benchmark 也仍未完成。因此本增量是 `implemented`，不是飞书整体 `verified` 或 v0.1 发布门。
