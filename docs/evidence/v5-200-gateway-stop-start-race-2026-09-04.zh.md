# V5.200：常驻 Gateway 启停竞态收口

> 日期：2026-09-04。范围：修复 resident Host 在 `dsh-gateway.start()` 尚未完成时收到停止信号会并发关闭 journal、transport 或配对存储的问题。

## 发现与修复

启动阶段会等待持久化 Session 列表和 journal 恢复。旧实现的 `stop()` 可以在这些等待仍未完成时直接执行资源关闭，导致启动继续访问已关闭资源；启动失败路径再调用公开 `stop()` 还可能与并发停止互相等待。现在：

- `stop()` 在资源关闭前等待当前启动 Promise settle，并用 `Promise.allSettled` 保留启动错误的诊断边界；
- Gateway 资源清理由 Host 内唯一的幂等 Promise 承载，启动失败和外部停止共享同一清理工作；
- 启动失败路径不再递归调用会等待自身的公开 `stop()`，因此不会死锁；
- 原生 session-event listener、outbound/transport、Agent handle、ingress journal 与 pairing authority 仍全部回收，后续调用继续 fail closed。

## 验证

开发前重新 fetch 并审计 canonical DSH `origin/master` `d347e703908d0406b7a7ef80e3a0e594d86b2215`（`0.1.3-alpha.1`）；本轮同步发现公开 tag `dsh-v0.1.3-alpha.1` 指向同一 revision。官方安装通过，根构建缺失 `@deepseek-ai/dsh-root/lib/types/{index,invariant,startup}.js` 的问题仍按上游缺陷处理。

```sh
DSH_SOURCE_ROOT=/path/to/buildable-dsh-support pnpm run generate:typert
pnpm --filter dsh-evoforge-gateway test -- --run
```

- Gateway 构建、Typert source digest 和 Node artifact 校验：通过。
- Gateway：`8` 个测试文件，`46/46` 通过。
- 新增成功启停竞态测试：停止不会在持久化列表仍被读取时关闭 ingress journal；启动完成后只关闭一次。
- 新增失败启停竞态测试：启动校验失败与并发停止共同完成，双方均 settle，journal 只关闭一次且原始 Session 错误保留。
- 未发送真实渠道消息、未读取或写入外部凭据；本增量只改变 Host 生命周期资源边界。

## 仍未证明

真实 Feishu/Telegram、真实 Provider、Hermes paired benchmark、长期负迁移/遗忘、npm namespace ownership 和发布 tag 门禁仍未通过；本证据不得扩大解释为 Hermes 上位替代完成。
