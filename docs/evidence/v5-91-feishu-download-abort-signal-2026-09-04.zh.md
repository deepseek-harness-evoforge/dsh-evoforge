# V5.91：飞书资源下载绑定取消信号

## 发现

`dsh-feishu` 在下载飞书消息资源时，原先只在调用前后检查 `AbortSignal`，但没有把 signal 绑定到
官方 SDK 使用的 Axios 请求上下文。Gateway 停止、Session 取消或 Adapter dispose 期间，如果平台请求
一直不返回，下载会继续占用连接，破坏常驻生命周期的可控清理。

## 修复

资源请求现在和文本、卡片、内容读取一样经过 Adapter 自己的 `transport.withSignal`。已有的大小限制、
流式上限和错误归因保持不变；没有提供 signal 的兼容调用仍走原请求路径。没有新增线程、队列、状态库、
Gateway 或 DSH API。

## 验证

- DSH 最新远端 `origin/master`：`76fda729799fe9b3848dbe2c211d4b231032b81e`，fetch 后与本地 HEAD 一致，
  DSH 工作树 clean。
- `pnpm --filter dsh-feishu run typecheck`：通过。
- `pnpm --filter dsh-feishu exec vitest run test/platform.test.ts test/inbound-images.test.ts --maxWorkers 1`：
  2 files、8 tests 通过。

## 边界

这只修复取消/清理语义，不能证明飞书真实 AS-2、Provider、Hermes paired 或长期效果门通过；这些门仍按
`release-gates.json` 保持原状态。
