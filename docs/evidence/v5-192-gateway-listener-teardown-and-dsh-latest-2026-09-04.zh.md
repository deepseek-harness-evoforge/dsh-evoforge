# V5.192：Gateway 监听回收与最新 DSH 基线复核

> 日期：2026-09-04  
> 工作树：`main`（提交前证据）  
> 目的：记录在最新 DSH revision 上完成的一个最小生命周期修复及全仓验证，不把本地通过误报为真实渠道或 Hermes 上位替代。

## 变更

`dsh-gateway` 以前只保存 `session/event` 监听的绑定状态，没有保存 Cordis 返回的移除函数。重复启停或卸载后，Gateway 自己的监听可能继续存活。本轮：

- 保存 `ctx.on('session/event', …)` 返回的 disposer；
- `stop()` 首次进入时原子地调用并清空 disposer；
- 重复 `stop()` 不会重复移除；
- 新增回归测试，确认一次停止恰好移除一次监听。

该修复只涉及 Gateway 自有监听；Feishu、Telegram、Host 凭据监听的 teardown 证据分别保留在此前版本文档中。

## DSH 最新基线审计

开发和验证前重新 fetch 了本机的 DSH canonical checkout：

| 项目 | 结果 |
| --- | --- |
| canonical `origin/master` | `d347e703908d0406b7a7ef80e3a0e594d86b2215` |
| DSH 版本 | `0.1.3-alpha.1` |
| clean / HEAD=origin/master | `true / true` |
| 官方安装 | 通过（退出码 `0`） |
| 官方根构建 | 退出码 `1`，分类 `blocked-upstream-root-types-entry` |

官方根构建失败是 DSH 当前 revision 自身的入口缺失：`@deepseek-ai/dsh-root` 仍声明
`lib/types/{index,invariant,startup}.js`，但该路径不存在。本仓库未修改 DSH 源码，也没有把该失败伪装为 EvoForge 失败或成功；本地插件检查使用已审计的 alpha.5 支持 checkout（`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`）以保持官方类型/协议矩阵可验证。

## 验证证据

- Gateway 定向 typecheck、build、Typert 产物校验通过；Gateway：`8 files / 42 tests passed`。
- Feishu：`19 files / 55 tests passed`；Telegram：`10 files / 36 tests passed`。
- Evolution：`69 files / 309 tests passed`。
- 根级 `DSH_EVOLVE_DSH_SOURCE_DIR=<audited-alpha5-checkout> pnpm run check`：`CHECK_RC=0`。
- 根级 Bundle、类型、构建、clean-profile、发布合同检查均按脚本完成；外部条件门禁仍按合同保留为未运行/阻断。

## 尚未通过的发布门禁

本证据不改变 `node scripts/check-release-gates.mjs --json` 的 `blocked` 状态。npm ownership、真实 Feishu AS-2、真实 Telegram AS-1、真实 Provider RP-1、完整 Hermes paired benchmark、长期效果和首个 SemVer tag 仍未达标。没有同任务、同模型、同权限、同预算的真实 paired 结果前，不声明“上位替代”。
