# V5.193：Gateway 启动失败自动清理

> 日期：2026-09-04  
> 工作树：`main`（提交前证据）  
> 目的：验证公开 `DshGateway` 类在启动校验失败时不会留下 journal、监听或 transport 资源。

## 问题与修复

Gateway 启动顺序会先恢复 ingress/outbound journal 并绑定 `session/event`，随后才校验持久化
Session 的 Workspace 身份。此前如果校验抛错，只有 Host `apply()` 的 catch 路径会调用 `stop()`；直接使用
Gateway 类的集成方可能遗留监听和打开的 journal。

本轮将启动主体置于失败清理边界：任意启动阶段异常都会 best-effort 调用幂等 `stop()`，再原样抛出原始错误。
新增回归测试使用跨 Workspace 的持久化 Session 触发失败，并确认 session-event disposer 恰好被调用一次、
生命周期进入 `stopping`，随后重复 stop 安全返回。该修复不引入第二套运行时或生命周期管理器。

## 最新 DSH 基线

开发和测试前重新 fetch 的 canonical DSH：

| 项目 | 结果 |
| --- | --- |
| `origin/master` | `d347e703908d0406b7a7ef80e3a0e594d86b2215` |
| 版本 | `0.1.3-alpha.1` |
| clean / HEAD=origin/master | `true / true` |
| 官方安装 | 通过（退出码 `0`） |
| 官方根构建 | 退出码 `1`，`blocked-upstream-root-types-entry` |

根构建缺陷仍来自 DSH `@deepseek-ai/dsh-root` 对不存在的
`lib/types/{index,invariant,startup}.js` 入口声明。本仓库没有修改 DSH 源码；EvoForge 插件检查继续使用已审计
alpha.5 支持 checkout 验证 DSH 类型和协议矩阵。

## 验证

- Gateway 定向 typecheck/build/Typert 产物校验通过：`8 files / 43 tests passed`。
- Feishu：`19 files / 55 tests passed`；Telegram：`10 files / 36 tests passed`。
- Evolution：`69 files / 309 tests passed`。
- 根级 `DSH_EVOLVE_DSH_SOURCE_DIR=<audited-alpha5-checkout> pnpm run check`：`CHECK_RC=0`。
- 文档、CI、Bundle、类型、构建、clean-profile 与发布合同检查通过；真实渠道、Provider、Hermes paired、长期效果和 npm/tag 门禁仍按合同阻断。

## 结论边界

这是可验证的生命周期可靠性增量，不是 Hermes 全量 paired benchmark，也不是“上位替代”声明。发布前仍必须完成真实 Feishu/Telegram、独立 Provider、同任务同模型同权限同预算 paired、长期负迁移/遗忘与精确恢复证据。

