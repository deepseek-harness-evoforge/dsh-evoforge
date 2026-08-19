# GW-1：`dsh-gateway` 原生包替换证据

> 日期：2026-08-19。范围：把未发布的 `dsh-channel-router` 直接替换为 `dsh-gateway`，迁移 Telegram、飞书和 Evolve Attention 消费者；不保留兼容包，不宣称完整 Gateway 已完成。

## 已证明

- 新包导出一个正式 DSH Cordis Bundle：`name = dsh-gateway`、`evoforge-gateway` patch、默认 disabled、无产品 CLI；
- Host 接缝改为 `evoforge.gateway` / `DshGateway`，公开 exact route、Workspace/Session/Agent dispatch 和 durable ingress journal；
- Telegram 与飞书只通过新 Gateway 类型和 Cordis service 运行，旧包名与旧 service id 不再出现在当前包、消费者、lockfile 或安装清单；
- 同一外部事件仍按 exact endpoint/route/content identity 去重；漂移拒绝；effect 边界崩溃仍进入 `uncertain` 且不盲重放；
- 十一个 packed Bundle 可由 DSH 官方命令一次 add，dump 中只出现新 `dsh-gateway` row；Host 启动后真实原生 Agent/Session/Goal/Tool 路径完成，全部 remove 后再次 boot 并读回原生 Goal。

## 本轮验证

| 门禁 | 结果 |
|---|---|
| `dsh-gateway` | 3 个测试文件、8 项通过；typecheck/build 通过 |
| 原生套件合同 | 1 个测试文件、22 项通过 |
| `dsh-telegram` | 10 个测试文件、39 项通过 |
| `dsh-feishu` | 15 个测试文件、41 项通过 |
| `dsh-evolve-attention` | 4 个测试文件、18 项通过，含 packed add/boot/remove |
| 十一包 clean-profile | 1 项完整 add/dump/boot/Agent/Goal/Tool/remove/reboot/readback 通过 |
| 全仓静态门禁 | 11 个用户包 typecheck、11 个用户包 build、文档门禁全部通过 |

## 未证明

- Gateway 尚未统一两个 Adapter 的 outbound intent/journal、限流和权威健康投影；
- 尚未完成真实飞书 exact chat/user 消息、文件/卡片、Approval 和多日重连；
- 本证据不涉及内部 Candidate 重构、真实 provider、Hermes paired 或发布 tag。
