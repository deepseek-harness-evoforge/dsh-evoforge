# V5.144：真实 Telegram AS-1 合同与零副作用预检

日期：2026-09-04  
EvoForge revision：`301c1a9`  
Canonical DSH 最新审计：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`0.1.2-rc.1`，`HEAD == origin/master`，clean。  
可运行 assembled 支持基线：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`，`0.1.2-alpha.5`，clean。

## 本轮交付

- 新增 `benchmarks/telegram-v0.1/as1-real-channel/`，定义真实 Bot 私聊的 resident pairing、原生回复、重复
  update 去重、一次性 Approval、Host 重启、卸载和 Session readback 关闭门。
- `contract.ts` 在授权前只读取 `DSH_TELEGRAM_REAL_CHANNEL_APPROVED`；授权后才读取并校验 token、account、官方
  API 地址、DSH 源码和仓库外 run root。公开 ready/terminal 报告不含 token、配对码或 Telegram chat/user id。
- manifest 同时固定可构建支持 revision 和开发前审计的最新 DSH revision，避免把旧 assembled 结果伪装成最新 DSH
  证据。终态解码器要求完整 observation 集和精确 revision/manifest/account identity。
- `run.ts` 当前只做安全预检；即使完整 token 已导出，也不会自动连接 Bot 或发送消息，直到完整的人机交互执行器
  通过独立 release gate 接入。

## 验证

在再次 fetch/核对 canonical DSH 后执行：

```sh
pnpm benchmark:telegram:as1:typecheck
pnpm benchmark:telegram:as1:test
```

结果：类型检查通过，合同测试 `8/8` 通过；未读取真实 Telegram 凭据、未连接 Telegram API、未产生外部消息。

## 当前结论

`real-telegram-as1` 已从“没有严格入口”提升为 `not-run`（有可复现的 fail-closed 合同），不是 `passed`。真实
Bot executor 仍需在同一 DSH revision、同一 clean profile 和新的仓库外 run root 中完成完整人工挑战；在此之前，
不能宣称 Telegram 真实可用、Hermes 上位替代或允许创建 release tag。
