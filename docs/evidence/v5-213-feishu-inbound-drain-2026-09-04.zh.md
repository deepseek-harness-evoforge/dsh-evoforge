# V5.213：Feishu 在途回调排空与停机顺序

> 日期：2026-09-04。范围：修复常驻 `dsh-feishu` 在平台回调已进入、但 Gateway 授权/原生 dispatch 尚未结束时的断连竞态。

## 问题

平台 SDK 的 `onMessage` 与 `onApprovalAction` 回调可能在监听撤销后仍持有并继续执行。旧流程在
`outbound.dispose()` 后立即调用 `platform.disconnect()`；如果回调随后才完成授权、配对码或响应准备，
它可能在连接已断开后才尝试产生平台副作用，或者把 teardown 失败记录成普通入站错误。

## 实现

- Feishu runtime 对两个平台回调建立统一的 active-callback 计数与 idle promise；回调入口同步登记，
  `finally` 必定归还计数，不依赖 SDK 是否等待异步 handler。
- `dispose()` 先标记 disposed、abort lifecycle、撤销监听、取消 pending approval、等待 Gateway outbound
  资源，然后等待已进入的回调排空，最后才断开 Feishu 平台并释放 transport。
- 排空设有与平台发送相同的 30 秒有界期限；不合作的平台回调不会无限阻塞卸载，超时会写入 Host logger，
  同时 lifecycle 已经 abort，后续可取消路径仍 fail-closed。
- `notifyHost()` 在输入校验前调用 `assertAvailable()`，已销毁 runtime 不再接受新的 Host 控制面通知。

## 验证

本轮开发前重新执行最新 DSH 审计：

- canonical DSH `origin/master`：`d347e703908d0406b7a7ef80e3a0e594d86b2215`
- 版本/tag：`0.1.3-alpha.1` / `dsh-v0.1.3-alpha.1`，安装通过，根构建仍为已记录的上游
  `@deepseek-ai/dsh-root/lib/types/{index,invariant,startup}.js` 缺失缺陷
- EvoForge 全量验证使用已审计可构建 alpha.5 支持组合：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`

新增回归先让 `gateway.authorize()` 停在未释放的 promise，再并发调用 runtime `dispose()`；断言平台在回调
释放前没有 disconnect，释放后恰好完成一次 disconnect。定向 Feishu runtime teardown 为 `3/3`，Feishu
全套为 `57/57`。

根级命令：

```sh
pnpm run audit:dsh:latest --source <DSH checkout>
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

结果：权威 `CHECK_RC=0`；Evolution `313/313`、Gateway `51/51`、Feishu `57/57`、Telegram `38/38`、
Evolve Web `27/27`、Control Center `5/5`、Doctor `40/40`、Goal Continuity `12/12`、GitHub Review `27/27`，
Resident `17` 通过/`1` 跳过，Software Delivery `34` 通过/`1` 跳过，clean-profile `1` 通过/`1` 跳过，
其余合同、兼容性、产物与发布脚本门通过。日志保留于 `/tmp/evoforge-v5213-check.log`。

## 边界

该证据只证明本地 Feishu runtime 在途回调与卸载顺序；不把 loopback 回归升级为真实飞书 AS-2、真实
Telegram、Provider RP-1、Hermes paired、长期负迁移/遗忘、npm ownership 或发布 tag 通过。真实外部
平台仍需显式授权后单独验收。
