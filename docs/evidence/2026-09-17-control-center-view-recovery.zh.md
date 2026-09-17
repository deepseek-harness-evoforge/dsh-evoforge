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

## 真实部署与界面复验

- 修复 `dc609ec` 已推送 main。通过已校验 product pack `b58fe130b5cfab14f3ea6a810e9517e3381f963c5d9940c4aa454f0121495862`
  仅安装其中的 Control Center tarball，其他六个生产包来源不变，保留此前飞书文件交付修复。
- 冷停已核实的唯一 Host，私有备份 profiles/sessions，再官方 add/dump；22 个历史文件及 profile patch 逐字节相同。
  没有修改配对、权限或凭据，仍仅一个 DSH Host。
- 相同会话中选择渠道→整页刷新，原生树与截图显示渠道仍 selected；渠道数据重新来自 Host，连接正常、授权 1、
  入站 14、出站 15。选择对话→返回控制台也保留渠道。
- 切换到已有独立验收会话，默认运行诊断；在该会话选择飞书内容，再返回原会话仍为渠道，没有会话之间的选择覆盖。
- 在渠道页受控停止唯一 Host，仍停留原子页并自动显示状态已过期、状态读取失败和上次状态：连接正常。
  启动同一 profile 后，不刷新或切页，告警自动消失、连接正常恢复，渠道保持 selected；最终仅一个监听进程。

这些检查不发送模型任务、不写原生业务状态。完整自我进化及 Hermes 同条件比较仍未完成，不据此声明总体目标完成。
