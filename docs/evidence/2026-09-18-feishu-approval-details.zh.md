# 飞书审批完整参数与安全回退

日期：2026-09-18。范围：飞书适配器展示层；不是完整真实渠道审批验收。
基线：`c3a3a745cf1397e2d72b7046bba91f7dafa10a92`。

## 问题与边界

旧卡只有工具名和原因，用户无法核对实际命令或路径。原生 assembled 回归证实缺少工具参数。
现在通过 ApprovalRequest.callId 关联当前原生 turn 的唯一同名 tool/call，原样展示 arguments。
同一调用 ID 可在后续轮次复用，不读取旧轮次参数；缺失、歧义、名称不符或超长时不截断后提供批准按钮，
而是提示用户在原生 Web 会话处理，并继续原生 answerer 链。无 callId 的请求明确标注未关联工具调用。

采用 Card 2.0 div/plain_text，避免参数被解释成 Markdown；依据
[飞书官方组件说明](https://raw.githubusercontent.com/larksuite/cli/main/skills/lark-im/references/card/components/div.md)。
不增加 Tool、模型前缀、持久化状态或审批权限；保留接收方、消息、身份和单次决定校验。
build-dsh-plugin 规范约束本次改动只通过原生事件与审批接口实现；没有修改 DSH 核心。

## 验证

使用当天已审计支持版本 DSH `0.1.6-alpha.1` / `0d1f500`；canonical HEAD `5dda764`、origin/master `ddefc45`，
均沿用此前记录的上游构建分类，不把支持版本称为最新。支持检出干净。

在 packages/dsh-feishu 执行：

```sh
pnpm run build
DSH_FEISHU_TEST_NATIVE_FILES=1 DSH_EVOLVE_DSH_SOURCE_DIR=<audited-dsh-source> pnpm exec vitest run test/approval-presentation.test.ts test/dsh-assembled-chat.e2e.test.ts test/dsh-assembled-content.e2e.test.ts test/dsh-assembled-file.e2e.test.ts test/pairing-assembled.e2e.test.ts test/dual-workspace-channels.e2e.test.ts --maxWorkers 1
```

- RED：文件路径 15 失败、5 通过；聊天路径缺少实际 bash 参数。首次筛选表达式造成全跳过，不算证据。
- 中间错误：全历史调用 ID 唯一性检查误拒绝复用 ID；改为当前轮次。ES2022 不支持 findLast，已替换。
- 最终上述六文件 33 通过、0 跳过；覆盖原始参数、边界长度、跨轮复用、缺失/歧义及原生回退。
- package-install-remove、runtime-dispose、websocket 三文件另外 5 通过、0 跳过；类型检查通过。
- 干净配置安装/移除及 assembled 路径不等同于真实飞书服务端渲染和点击。

## 部署与恢复

仅更新飞书包，tarball SHA256 `42c78dcd4dcf093f239771b8e68ffe6fcae27b8a88414fae5bc18f008225cdaf`。
先备份 profile、31 个 Session 和五份学习/外发账本，确认后台检查结束后停止旧 Host，再通过官方 plugin add 安装。
最初误用顶层 add 被 CLI 拒绝、未安装；改用 plugin add 成功。包名校验首次断言写错，在启动前修正。
最终仅飞书依赖改变，策略与其他 package 字段不变，已安装 dist 与测试构建逐字节相同。
唯一 Host 在原 localhost 端口启动；Web 整页刷新后原会话保持 32 轮、66 步与完全权限，渠道显示连接正常。
所有旧 Session header/事件前缀完整，仅追加一条原生 session/end-seed；五份账本字节不变。
未发送新任务、调整权限或追加付费调用。
回退只重装备份记录的旧飞书包，不覆盖会话或账本；旧包会重新缺少参数展示。

## 尚未证明

真实飞书审批卡渲染、点击及端到端允许/拒绝仍待授权进行；原会话完全访问，不擅自切换权限触发审批。
本轮渠道连接健康不是审批成功证据，也没有复用此前普通消息回执冒充新包审批验收。
自我进化未见任务收益、Hermes 同条件比较及整体阶段验收仍未完成。
