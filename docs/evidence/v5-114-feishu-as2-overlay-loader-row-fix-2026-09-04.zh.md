# V5.114：真实飞书 AS-2 启动前 Loader 行冲突修复

## 结论

本轮发现并修复了真实 Feishu AS-2 在官方传输启动前失败的本地配置错误。验收 overlay 将 DSH Web 已提供的
`web-runtime` 行放进 `insert` 列表，Loader 因此把它当作第二个新行注册，报：
`duplicate loader entry id: web-runtime`。修复后改为按官方 patch 语义在顶层以 `id: web-runtime` 替换整行，
其余 AS-2 专用行仍通过 `insert` 添加。

这次失败没有连接飞书、发送消息、读取入站事件或产生任何外部效果；原失败 run root 保留，不能作为真实渠道
通过证据。真实 AS-2 仍须使用新的隔离 run root 重新执行。

## 复现事实

- canonical DSH preflight：`HEAD = origin/master = 76fda729799fe9b3848dbe2c211d4b231032b81e`，工作树 clean；
- assembled 支持基线：`/private/tmp/evoforge-dsh-latest.qPqo1d`，alpha.5；
- 旧 run 在 `official-transport-start` 前失败，错误为 `duplicate loader entry id: web-runtime`；
- 失败结果未观察到 `officialTransportReady`、配对请求、入站、回复或外部副作用。

## 修复与验证

`benchmarks/feishu-v0.1/as2-real-channel/execute.ts` 的 `writeAcceptanceOverlay` 现在生成：

1. 顶层 `- id: web-runtime` 完整替换 DSH Web Bundle 的同名行，并关闭非交互验收的 URL、浏览器交接和模型可见
   Web 上下文；
2. 独立的 `- insert:` 只包含 mock LLM、Schedule、Gateway 和 Feishu 行。

在 canonical DSH fetch/clean preflight 后执行：

```text
pnpm run benchmark:feishu:as2:check
```

结果：AS-2 类型检查通过；安全/输入/终态契约测试 `10/10` 通过。随后尝试启动真实 AS-2 时，runner 正确拒绝了
尚未提交的 EvoForge 工作树（`AS-2 requires a clean EvoForge revision before real effects`），未读取凭据或发起
平台请求；这证明修复必须先原子提交后再进入真实效果阶段。

## 未完成门禁

本证据只关闭一个本地 Loader 启动阻断，不改变 `release-gates.json`：真实 Feishu AS-2、真实 Provider、Hermes
paired、长期效果、外部 Telegram 和 npm 名称归属仍未通过，不能创建发布 tag 或宣称 Hermes 上位替代。
