# 飞书已处理审批卡的结果反馈

日期：2026-09-18；开发基线 `bbb83618a6c1b77507a0c69d7bc48f9ddd7964e6`。
本次证据为原生 assembled 复现、平台接口测试和部署恢复检查；真实飞书审批点击尚未完成。

## 可复现问题

原生 assembled 聊天路径发送一张审批卡，错误消息/聊天/操作者点击均被拒绝；正确操作者点击后，
原生 Approval 返回 allowed-once、待处理数归零，但平台没有收到原卡更新请求。因此旧卡继续显示等待与按钮。
新增断言首次失败：预期原消息的一次无按钮确认卡，实际 cardUpdates 为 []。
这证明适配器缺少结果反馈，不冒充真实飞书客户端已经观察到同一症状。

## 改动与边界

只对已通过原有消息/聊天/操作者校验、仍在当前 pending 映射中的决定：先消费 nonce、移除取消监听并交回原生结果，
再对已知外部消息 ID 做一次展示更新。允许文案为“已提交允许一次”，明确“不代表任务已完成”；拒绝亦单独说明。
两者都没有批准按钮。重复点击、错误身份或失效 nonce 不更新、不重新决定。

使用官方 SDK 1.73.3 的 `im.v1.message.patch`，请求只包含 exact message_id 与卡片 JSON；
对应[官方更新接口](https://open.feishu.cn/document/server-docs/im-v1/message-card/patch)。
不用隐藏回调服务，不新增消息、Tool、模型前缀、调用、持久化审批状态或 Host。
对既有消息的投影替换不作为新的任务执行收据；不持久化重试队列、不自动重放。

code 非零、缺少明确成功回执或网络错误均按“更新未确认”处理，使用固定脱敏错误。
决定不会因卡片网络失败改变或重试；现有渠道故障边界显示 degraded。
更新使用生命周期信号和现有平台超时；入站回调由已有 dispose drain 等待，卸载取消进行中的更新。
不承诺撤回已经到达平台的效果。自定义旧平台可不实现可选 updateCard；其原有审批仍工作，但不具备刷新能力。
取消、崩溃或断电后的旧卡不在本次历史修复范围内；失效按钮不能重新批准，请回 Web 核对。

`diagnosing-bugs` 先建立失败回归；`build-dsh-plugin` 限定为原生审批之上的平台展示，不建立第二审批权威。
DSH 使用已审计支持版本 `0.1.6-alpha.1 / 0d1f500`；当天再次 fetch：canonical HEAD `5dda764`、
origin/master `ddefc45`，支持检出干净；复用当天 frozen install/full build，不把支持版本称为最新。

## 实际命令与结果

工作目录 packages/dsh-feishu，DSH_EVOLVE_DSH_SOURCE_DIR 指向上述支持检出：

```sh
pnpm run build
DSH_FEISHU_TEST_NATIVE_FILES=1 DSH_EVOLVE_DSH_SOURCE_DIR=<audited-dsh-source> pnpm exec vitest run test/platform-card-update.test.ts test/dsh-assembled-chat.e2e.test.ts test/dsh-assembled-file.e2e.test.ts test/runtime-dispose.test.ts test/websocket-lifecycle.test.ts --maxWorkers 1
DSH_EVOLVE_DSH_SOURCE_DIR=<audited-dsh-source> pnpm exec vitest run test/platform-card-update.test.ts test/package-install-remove.e2e.test.ts test/runtime-dispose.test.ts --maxWorkers 1
pnpm exec tsc --noEmit -p tsconfig.json
```

- 首个 assembled RED：1失败，原卡更新缺失；平台接口 RED：5失败，updateCard 不存在。
- 初次 GREEN 尝试中测试 beforeEach 意外返回 mock 函数，被测试框架当成清理函数执行；已改为无返回值，未弱化断言。
- 第一组合最终30通过、0跳过；覆盖允许、拒绝、重复/错误点击和更新失败不改变决定。
- 补充平台迟到成功/取消后，第二组合10通过、0跳过；包含干净 profile 官方安装/dump/SDK解析/移除。
- 最后再加“更新仍挂起时原生允许先完成、dispose取消并等待更新”的 assembled 回归，单文件1通过、0跳过。
- 类型检查、正式 pnpm pack 构建通过。上述组合有重叠，不汇总为独立用例数。

## 部署恢复

包 SHA256 `01e9ec8f9c5edf75bca35a9dc4a5f4082b2e05c37d421a88486de822e4ceb38a`。
备份原 profile、31 Session 与五份学习/外发账本；实际原生后台检查已结束后停止旧 Host，通过官方 plugin add 更新。
只有飞书依赖改变，其他 package 字段及策略逐字节不变，安装 dist 与测试构建相同。
唯一 Host 在原 localhost 端口运行；31个Session header/事件完全相同、零追加，五账本字节不变。
Web 整页刷新，原会话保持32轮66步、完全权限；飞书显示连接正常，既有配对仍在，未发新任务或追加模型调用。
回退只重装备份记录的旧飞书包，不覆盖历史；旧包将再次没有点击后反馈。

## 仍待验收

真实飞书卡片更新与允许/拒绝完整路径未证明。生产原会话完全访问；临时收紧权限的询问尚未获答复，未擅自执行。
连接正常、组合测试通过不能替代真实服务端/客户端验收。整体学习收益、精确回滚和 Hermes 同条件比较亦未完成。
