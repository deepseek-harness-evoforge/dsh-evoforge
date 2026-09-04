# V5.205：Gateway Bundle 启动错误传播与全量复验

> 日期：2026-09-04。范围：修复 `dsh-evoforge-gateway` Bundle 的 `apply()` 在启动失败后清理失败会覆盖原始错误的问题。

## 修复

Bundle `apply()` 现在在 `gateway.start()` 失败后等待 `gateway.stop()` 的清理 Promise，但用 `Promise.allSettled` 保留原始启动错误；清理失败仍通过 Host logger 记录。新增 Bundle 级回归，验证 journal close 失败时 DSH Host 收到的仍是 startup validation 错误，而不是无关的 teardown 错误。

## 基线与验证

- canonical DSH `origin/master`: `d347e703908d0406b7a7ef80e3a0e594d86b2215`
- DSH 版本/tag：`0.1.3-alpha.1` / `dsh-v0.1.3-alpha.1`（同一 revision，clean，`HEAD == origin/master`）
- EvoForge 可构建支持组合：alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`
- DSH 官方安装通过；根构建缺失 `@deepseek-ai/dsh-root/lib/types/{index,invariant,startup}.js` 仍为上游缺陷

开发前重新 fetch DSH，随后执行：

```sh
pnpm --filter dsh-evoforge-gateway typecheck
pnpm --filter dsh-evoforge-gateway test -- --run
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/buildable-dsh-support pnpm run check
```

结果：

- Gateway：`9` 个测试文件，`48/48` 通过；Bundle `apply()` 错误传播回归通过。
- 根级全量检查：权威 `CHECK_RC=0`；Evolution `309/309`、Gateway `48/48`、Feishu `56/56`、Telegram `38/38`、Evolve Web `27/27`、Control Center `5/5`、Doctor `40/40`，Goal Continuity `12/12`、GitHub Review `27/27`；Resident `17` 通过/`1` 跳过，Software Delivery `34` 通过/`1` 跳过，clean-profile `1` 通过/`1` 跳过，其余合同与产物门通过。
- 未发送真实渠道消息、调用真实 Provider 或读写外部凭据。

## 解释边界

本证据只证明 Bundle 启动错误传播及本地全量回归稳定，不证明真实渠道、Provider、Hermes paired benchmark、长期负迁移/遗忘、npm ownership 或发布 tag 门禁已通过。
