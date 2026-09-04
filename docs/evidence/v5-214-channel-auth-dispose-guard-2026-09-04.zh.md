# V5.214：渠道授权返回后的销毁闸门

> 日期：2026-09-04。范围：避免 Feishu/Telegram pairing 在授权请求跨越 runtime 卸载边界时调用平台 API。

## 问题

常驻 Adapter 的入站处理会等待 Gateway `authorize()`。如果 Host 在等待期间卸载 Adapter，旧实现只依赖
传给平台 SDK 的已中止 `AbortSignal`；不遵守取消信号的 SDK 仍可能发送配对码，形成卸载后的外部副作用。

## 修复

- Feishu `handleMessage()` 在 `authorize()` 返回后重新检查 runtime lifecycle。已销毁时直接结束回调，不进入
  pairing code、附件处理、dispatch 或 response 路径。
- Telegram pairing `handleUpdate()` 在授权返回后执行同样的生命周期检查，避免 Bot API `sendMessage` 被迟到调用。
- 与 V5.213 的 Feishu 在途回调排空配合：仍会等待已经进入的 handler settle，但不会让授权迟到结果重新打开
  平台副作用。

## 验证

本轮开发/验证前重新执行最新 DSH 审计：

- canonical DSH `origin/master`：`d347e703908d0406b7a7ef80e3a0e594d86b2215`
- 版本/tag：`0.1.3-alpha.1` / `dsh-v0.1.3-alpha.1`，安装通过；根构建仍为上游缺失
  `@deepseek-ai/dsh-root/lib/types/{index,invariant,startup}.js` 缺陷
- EvoForge 根检查继续使用已审计可构建 alpha.5 支持组合：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`

Feishu teardown 回归将授权 promise 阻塞到 runtime dispose 之后，释放后返回 pairing offer，断言发送次数为零；
Feishu `57/57`、Telegram `38/38` 与类型检查通过。根级命令：

```sh
pnpm run audit:dsh:latest --source <DSH checkout>
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

结果：权威 `CHECK_RC=0`；Evolution `313/313`、Gateway `51/51`、Feishu `57/57`、Telegram `38/38`、
Evolve Web `27/27`、Control Center `5/5`、Doctor `40/40`、Goal Continuity `12/12`、GitHub Review `27/27`，
Resident `17` 通过/`1` 跳过，Software Delivery `34` 通过/`1` 跳过，clean-profile `1` 通过/`1` 跳过，
其余合同、兼容性、产物与发布脚本门通过。日志保留于 `/tmp/evoforge-v5214-check.log`。

## 边界

该证据只证明本地 Adapter 授权/卸载边界；真实 Feishu/Telegram 外部通路、Provider RP-1、Hermes paired、
长期效果、npm ownership 和发布 tag 仍按 release gates 保持未通过或未运行。
