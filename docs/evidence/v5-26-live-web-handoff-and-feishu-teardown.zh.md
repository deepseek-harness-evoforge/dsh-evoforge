# V5.26：常驻 Web 交付入口与飞书 teardown 竞态修正

- 日期：2026-08-25
- DSH revision：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`dsh-v0.1.1-rc.2`）
- 范围：测试浏览器副作用、常驻 Web 真实点击、飞书与 Gateway 并发卸载
- 状态：已通过定向门与根级 `pnpm check`

## 用户可见故障与根因

真实 Chrome 的 `http://127.0.0.1:56017/` 被“内测声明”遮罩阻断；点击“继续”只显示
“暂时无法保存确认状态，请重试”。对该 exact 标签页的检查同时得到：

- `lsof` 确认 `56017` 无监听进程；
- 页面 console 连续报告 `web-runtime connection lost`；
- Chrome 中另有多组同类随机端口标签，均来自 clean-profile 生命周期测试退出后的浏览器交付副作用。

因此问题不是确认按钮或 onboarding 存储契约，而是测试 Host 已退出、静态页面仍留在用户浏览器。此前在已经
确认过的 `3080` 页面验证插件控制面，不能证明这个临时标签可用。

## 修正

1. clean-profile 与 frozen-predecessor→current 升级纵切的 CLI Host 探针显式传 `--no-open`；
2. 两条纵切中通过 `appBoot.boot()` 直接组装 profile 的路径，也经官方 `cmdlineArgs` 传 `--no-open`；
3. AS-2 真实执行器的直接 boot 与 CLI Host 探针同步使用 `--no-open`，真实平台验收仍由受控浏览器负责；
4. 已确认无监听的测试标签被清理；原 `56017` 标签切换为常驻 `http://127.0.0.1:3080/`；
5. 同一真实 Chrome 标签实际点击“渠道健康”并刷新，读取到 Gateway `ready`、1 条动态 route、1 个实时
   Session、飞书 WebSocket `ready`、3 条入站、3 条出站、0 pending/uncertain/failed；
6. 修正后分别重跑 clean-profile 与完整升级纵切；Chrome 的本地页面清单都只有常驻 `3080`，没有新增
   随机端口。

## 飞书卸载竞态

根级检查另暴露一个真实 teardown 竞态：Cordis 并发卸载兄弟插件时，Gateway 可能先停止；飞书 Runtime 随后
上报 `stopping` 会抛错，旧实现因此跳过 outbound dispose、平台 disconnect 和 transport dispose。服务虽从 Host
移除，底层连接仍可能残留。

`FeishuRuntime.dispose()` 现在隔离每个 teardown 阶段的失败，保证后续阶段继续执行，最后才重抛单个错误或
聚合多个错误。确定性回归测试强制 Gateway 拒绝 stopping report，并验证平台仍断连、outbound 与 transport
仍释放；assembled resident pairing 测试连续运行 30 次全部通过。

## 已通过检查

- `pnpm --filter dsh-software-delivery exec vitest run test/clean-profile-suite.e2e.test.ts --maxWorkers 1`：
  1 file / 1 test passed；
- `pnpm --filter dsh-software-delivery exec vitest run test/suite-upgrade.e2e.test.ts --maxWorkers 1`：
  1 file / 1 test passed（108.69 秒）；
- `pnpm benchmark:feishu:as2:typecheck`：通过；
- 两条纵切修正后真实 Chrome 本地页面：仅 `http://127.0.0.1:3080/`；
- pairing assembled 重复门：30/30 次通过；
- `pnpm --filter dsh-feishu typecheck`：通过；
- `pnpm --filter dsh-feishu test`：18 files / 45 tests passed；
- 根级 `pnpm check`：通过；RP-1 8/8、AS-2 9/9、全 workspace typecheck/test/build 均完成。

## 边界

- 本增量不修改 DSH onboarding，也不 fork DSH；死端口不能作为 DSH 或插件缺陷证据；
- `3080` 是当前人工交付入口，随机端口只允许在受控测试内部存在且不得打开用户浏览器；
- 真实飞书 grant 未撤销，现有 route、Session 与 journal 未改写；
- 完整 AS-2 epoch-3、真实撤销重配、Approval/Schedule/group、长期重连与 Hermes paired 仍未完成。
