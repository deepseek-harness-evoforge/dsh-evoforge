# V5.87：飞书策略拒绝可观测性（2026-09-04）

## 目的

修复真实渠道诊断中的一个盲区：官方飞书 WebSocket 已经收到事件，但 Node SDK 的安全策略因群聊未提及、
发送者/群聊不在 allowlist、私聊禁用或 mention-all 被阻断而拒绝时，原健康页只能看到“没有入站事件”。
本增量不改变授权、配对、路由或 Agent 投递，只把安全决策的原因以脱敏字段投影到已有的 DSH Gateway 健康面。

## 实现

- `dsh-feishu` 的官方平台适配 `@larksuiteoapi/node-sdk` 的 `reject` 事件，并只向 Runtime 暴露
  `RejectReason`；`messageId`、`chatId`、`senderId` 不离开平台适配边界。
- Runtime 在原生 transport registration 上继续报告连接/活动事实，同时记录最近一次策略拒绝的时间和原因。
  策略拒绝不是传输故障，不会把状态从 `ready` 改成 `degraded`。
- `EVOFORGE_FEISHU_HEALTH_V2` 的 transport 增加可选
  `lastPolicyRejectAt` 与 `lastPolicyRejectReason`，解析器只接受官方五种 reason；旧快照仍可读取。
- 原生 Control Center 的技术详情显示“最近策略拒绝”，与“最近收到平台事件”并列；健康页不主动探测飞书权限，
  不显示身份、凭据、外部消息 ID 或正文。
- 用户 README 已补充该诊断字段的含义和边界。

## 验证

开发前重新执行：

```sh
git -C <workspace>/deepseek-harness fetch origin --tags --prune
git -C <workspace>/deepseek-harness rev-parse HEAD
git -C <workspace>/deepseek-harness rev-parse origin/master
```

结果：DSH 工作树干净，`HEAD == origin/master ==
76fda729799fe9b3848dbe2c211d4b231032b81e`，公开描述为
`dsh-v0.1.2-rc.1-99-g76fda72979`；EvoForge 运行时验证仍使用已构建且受支持的 alpha.5
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

通过的定向命令：

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d \
  pnpm --filter dsh-feishu typecheck
pnpm --filter dsh-feishu exec vitest run --maxWorkers 1 \
  test/health.test.ts test/platform.test.ts
```

结果：类型检查通过；健康/平台 2 个测试文件、8 个测试通过；assembled chat 端到端夹具 1/1 通过。健康契约
覆盖 ready 状态下策略拒绝仍可见、机器行可往返解析、非法 reason 被拒绝；assembled 夹具再验证 Runtime
生命周期实际接收并投影 `sender_not_allowed`；平台契约继续覆盖代理与官方传输适配。

在公开类型导出补齐后再次执行 `pnpm --filter dsh-feishu build`，Node 与 Client 两个入口均成功生成；随后
`pnpm run check:docs` 与 `git diff --check` 通过，确保最终 Bundle 与源码导出一致。

## 边界与发布门

这不是一次真实飞书事件验收，也不把 SDK 的 `ready` 或本地测试当作真实渠道通过。`real-feishu-as2` 仍需在
全新 profile 中收到陌生私聊、配对、回复、原生 Command、Schedule、Approval、notice、重启、卸载和 readback；
`real-provider-rp1`、Hermes paired、长期效果和 release tag 门也保持原状态。策略拒绝的消息仍不会进入 DSH
Agent，这是安全合同而非失败重试。
