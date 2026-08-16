# PA-1 Protected Action Hard Gate 证据

> 日期：2026-08-17
> 状态：implemented；真实第三方对抗验证待完成

## 目标

证明 EvoForge 的自治、恢复和自动晋升不会把默认开发授权扩张为 merge、release、生产部署、秘密读取、未经策略允许的付费调用或不可逆外部动作。该 Gate 不建立第二套权限系统；DSH Approval、Permission Preset、Sandbox 与显式部署策略仍是运行时权威。

## 一个可执行入口

```bash
pnpm test:pa1
```

该命令聚合既有公开 Interface 上的行为测试，而不是检查源码关键词。macOS CI 运行完整 sealed boundary；其他平台明确跳过 Darwin Seatbelt case，不把缺少隔离器误报成通过。

本地 macOS 2026-08-17 结果：`74 passed | 1 skipped`；唯一 skip 是需要显式
`DSH_DELIVERY_LIVE_WORKTREE` fixture 的可选真实 worktree case，Darwin Seatbelt hard gate 已通过。
固定 macOS CI 也必须把全部 sealed boundary 跑绿。

## Hard gate 映射

| 风险 | 行为证据 | 失败时阻止什么 |
|---|---|---|
| 自动晋升扩大权限 | `auto-promotion-policy.test.ts` 要求 allowlist、append-only、单一 `SKILL.md`、四次 sealed Trial、clear win；`candidate-impact.test.ts` 固定 deploy、secret、network、payment、permission 等 protected-effect 投影，命中均转人工 review | 自动 approve/promote |
| Candidate 读取秘密或产生外部效果 | `sealed-trial-darwin.e2e.test.ts` 实测 inherited secret 被清空、host read/outside write/network/undeclared child executable 均被 Seatbelt 拒绝 | Trial 完整结论与自动晋升 |
| 付费 proposer 被隐式或重复调用 | `evolution-action.client.test.tsx` 在确认前不调用 Shadow；`feedback-shadow-launcher.test.ts` 只接受显式 signal/target；`shadow-resume.e2e.test.ts` 在 paid outcome 不确定时不重试 proposal | 背景付费与重复付费 |
| Delivery 越过 Draft PR | `complete-delivery.test.ts` 精确锁定 Tool 只有 Goal/worktree/base/checks/draft-PR 六类顶层参数，只发布/复用 Draft，认证失败时 push 为零，已 ready PR 不被修改，网络不确定先查远端事实 | Goal 完成与外部发布 |
| secret 进入子进程或长期证据 | `verify-delivery.test.ts` 清理 credential-bearing environment；Shadow/Feedback 测试验证 API key、反馈正文与 note hash 不进入报告和 Signal | check/Trial 执行与持久化 |
| 消息 Adapter 改写秘密或路由目标 | `protected-route.test.ts` 只允许 official Telegram HTTPS 或 loopback 测试端点，静态绑定 exact Agent/chat/user 与一个合法 token env 名；`telegram-api.test.ts` 验证 token 不进入失败结果；`inbound.test.ts` 拒绝非 private、错误 chat/user、过期或伪造 callback | Bot 启动、消息进入 DSH 与 Approval 回答 |
| 回滚虚称撤销现实副作用 | `generation-store.e2e.test.ts` 只原子切换 future-session Generation pointer，并保留 exact rollback target；外部 PR/消息/部署不属于 capability rollback | capability selection 更新 |

## 结论边界

当前证据支持 `PA-1 implemented`，不支持“所有第三方插件都安全”或“无需人工批准”。真实 provider、恶意仓库、不同操作系统和明确部署策略仍需独立对抗测试；merge、release、生产部署、秘密读取和不可逆动作继续由原生 DSH authority 决定。
