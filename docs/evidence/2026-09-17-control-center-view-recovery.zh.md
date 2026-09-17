# 控制台子页选择恢复

日期：2026-09-17。目标：在原生控制台选择渠道后，刷新或返回控制台仍显示该子页；不同会话独立。

## 真实复现与原因

在当前 `e1bf918` 部署、同一个原生会话中，点击控制台→渠道，再整页刷新：外层控制台保持选中，但子页变回运行诊断。
可访问树明确显示刷新前渠道 selected=1，刷新后运行诊断 selected=1。这不是登录丢失、会话变化或插件注册顺序变化。
ControlCenterView 原来只用 React useState 记录选择，重建组件即丢失；注入已保存渠道选择的组件回归稳定失败。

## 修复边界

沿用 DSH Client 原生 defineStore 与 conversation.view 的 store seat；由原生 renderer 管理每个 Session 的实例、订阅
和持久化后缀。插件只存浏览器显示偏好 `requested`，不存渠道快照、权限、凭据或原生业务事件；模型组成与 Host seam 不变。
偏好解析或存储失败不会阻止导航，当前缺失插件回退到第一个可用子页但不覆盖偏好。无可用插件保留已有空态。
DSH 卸载清理实例，保留无害的显示偏好；原生 Session scope 删除时清理其活动 store 的键，不清理其他 Session。

Client 包将 `@deepseek-ai/dsh-client-store` 保持为 Web Host seeded external，不打包第二份引擎。测试显式解析原生发布包
未内嵌的 Zustand/Immer，版本与已审计 Host lock 一致；上游缺失 source map 的警告不影响结果，未修改上游包。

## 本地与组合验证

- canonical 独立 checkout fetch 后 HEAD=origin/master=`0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`，tag
  `dsh-v0.1.6-alpha.1`、CLI `0.1.6-alpha.1`；工作树干净、frozen install 和完整原生 build exit 0。
- Control Center：build、16 tests、typecheck 通过。覆盖新实例恢复、不同 Session、缺失/晚到贡献、无插件、错误 JSON/
  错误结构、存储拒绝、键盘切换、native clearPersisted 和 ARIA 实例隔离。
- Gateway、Feishu、Evolution Web、Doctor typecheck 通过；Doctor suite native contract 24 tests 通过。
- `DSH_EVOLVE_DSH_SOURCE_DIR=<audited-host> pnpm exec vitest run test/clean-profile-suite.e2e.test.ts --maxWorkers 1`
  在 software-delivery 包通过 2 tests（40.90 秒）：packed add/dump、原生 Session/Goal/Storage、dispose/remove/native readback。
- frozen install、peer 检查、check:docs、check:ci 和 whitespace 检查通过。隔离预检 home 的官方 product 安装与 dump 通过。

本节尚不代替实际生产页面复验；部署后补充相同点击/刷新链路结果。
