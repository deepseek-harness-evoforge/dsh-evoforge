# V5.202：Gateway 启动清理错误边界与全量门复验

> 日期：2026-09-04。范围：修复启动失败时 cleanup 错误覆盖原始校验错误的边界，并在最新 DSH 基线上重跑根级检查。

## 修复

当 Gateway 启动校验失败且 journal/transport 清理也失败时，启动调用方现在仍收到原始路由或 Session 校验错误；公开 `stop()` 仍返回共享清理 Promise，保留清理失败可诊断性。新增回归覆盖启动失败、并发停止和清理失败同时发生的情况。

## 基线与验证

- canonical DSH `origin/master`: `d347e703908d0406b7a7ef80e3a0e594d86b2215`
- DSH 版本/tag：`0.1.3-alpha.1` / `dsh-v0.1.3-alpha.1`（同一 revision，clean，`HEAD == origin/master`）
- EvoForge 可构建支持组合：alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`
- DSH 官方安装通过；根构建缺少 `@deepseek-ai/dsh-root/lib/types/{index,invariant,startup}.js` 的问题仍为上游缺陷

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/buildable-dsh-support pnpm run check
```

权威退出码：`CHECK_RC=0`。

- Evolution `309/309`
- Gateway `47/47`
- Feishu `56/56`
- Telegram `38/38`
- Evolve Web `27/27`、Control Center `5/5`、Doctor `40/40`
- Goal Continuity `12/12`、GitHub Review `27/27`
- Resident `17` 通过、`1` 跳过；Software Delivery `34` 通过、`1` 跳过；clean-profile `1` 通过、`1` 跳过
- Typert、Node artifact、Bundle/套件、兼容性、文档和发布脚本合同门：通过

没有发送真实渠道消息、调用真实 Provider 或读写外部凭据。

## 解释边界

本证据只证明生命周期错误边界及其对本地全量门的兼容性。真实 Feishu/Telegram、Provider、Hermes paired benchmark、长期负迁移/遗忘、npm ownership 和发布 tag 门禁仍未通过，不能宣称 Hermes 上位替代完成。
