# V5.198：常驻 Gateway 并发启动幂等

> 日期：2026-09-04。范围：修复同一 DSH Host 在重连或生命周期竞态中同时调用两次 `dsh-gateway.start()` 时可能重复恢复 journal、注册监听和执行路由校验的问题。

## 修复

`DshGateway` 现在用 Host 内部唯一启动 Promise 合并并发 `start()` 调用；已启动实例仍立即返回，已进入停止态仍 fail closed。启动失败的原有回收边界保持不变，Typert 公共契约没有增加第二个生命周期或 Runtime。

## 验证

开发前已重新 fetch 并审计 canonical DSH `origin/master` `d347e703908d0406b7a7ef80e3a0e594d86b2215`（`0.1.3-alpha.1`）；官方安装成功，根构建缺陷仍由上游 `@deepseek-ai/dsh-root` 缺失类型入口触发。

```sh
DSH_SOURCE_ROOT=/path/to/buildable-dsh-support pnpm run generate:typert
pnpm --filter dsh-evoforge-gateway test
```

- Gateway 构建、Typert source digest、Node artifact 校验：通过。
- Gateway：`8` 个测试文件，`44/44` 通过；新增并发启动测试确认两次调用共享同一个 Promise，session-event listener 只注册一次，最终健康状态为 `ready`。
- 未发送真实渠道消息、未读取或写入外部凭据；该修复只改变 Host 生命周期并发行为。

