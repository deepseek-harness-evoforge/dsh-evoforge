# P1.16 Automatic Evaluator Draft 验证记录

> 日期：2026-08-17；结论：`implemented`，不等于真实 provider 或长期效果已验证

## 用户结果

明确纠正若只匹配一个静态授权 Skill，常驻 `dsh-evolve` 会先持久预留当日预算，再复用 P1.9 生成一个私有、不可执行 Evaluator Draft。产生纠正的 Session 不等待；人工仍必须在独立 inbox 审查并 sealed qualification，随后另行授权 Shadow。零匹配、多匹配、预算耗尽、journal 不可信或外部结果不确定均转人工。

## TDD 与故障边界

实现前测试首先因 `automatic-evaluator-draft.ts` 不存在而失败；Commands、Control Plane 与 Web 的新预算投影随后分别红灯。最终覆盖：

- 唯一 Skill 匹配时调用顺序严格为 `durable budget → existing author()`；每轮最多一个；
- 多 Skill 匹配不预留、不请求，重复扫描只报告一次；
- UTC 日额度耗尽后延迟，新日才可继续；损坏状态只投影 `unknown / remaining=0`；
- 空 Target、相对路径、filesystem root、重复 Skill/id/root、超过 `1..20` 和与 Automatic Feedback Shadow 同 Skill 均在启动时拒绝；
- 第一次预留可安全创建静态 owned root（`0700`），journal 为 `0600`；run root/journal symlink 均 fail closed；
- `SIGKILL` 落在 provider 已收到请求、host 未收到结果之后：重启复用同一 Signal reservation，P1.9 状态为 `uncertain`，provider request count 保持 `1`，secret、用户正文与 correction 不进入 budget journal；
- `authoring-pending` 不自动重试；显式人工 author/approve/reject/Shadow 路径保持可用。

## 真实 DSH 纵向链路

固定 revision `47f943859bef60e4160492346772ded9b24f765a` 的真实 DSH Agent/Session Persistence/Message Feedback/Jobs/Commands/Skill/Storage 装配完成：

```text
real Agent turn
  → explicit negative feedback + correction
  → resident scan
  → durable daily reservation
  → one real local HTTP evaluator-author request
  → private inactive Draft
  → explicit human qualification
  → explicit Qualified Shadow
  → calibrated paired Trial / pending review
```

链路中 author request 恰好 `1`，qualification 不调用模型，Shadow proposer 恰好 `1`；当前 Session 继续固定原 Generation，active Generation、Git Skill 和工作树均未变化。打包后的插件也通过真实 DSH CLI add/boot/remove/native boot 生命周期。

## KV Cache 与 Web

64 轮真实 Agent 对照把 P1.16 静态策略一并启用；每轮完整模型可见请求仍与无 EvoForge 控制组相等，当前 Session 的后一请求保留前一请求完整前缀。P1.16 不注册 Tool、Prompt、Skill 或 Session event，普通请求 token 增量为 `0`；唯一新增费用是静态策略允许的 evaluator-author request，输出上限固定 `1,600` token，并受每 Target 日 cap 限制。

真实 Chrome 打开产品 React/CSS fixture 后可见：

- `Feedback Shadow · plugin-delivery · build-dsh-plugin` 与 `1/2`；
- `Evaluator Draft · novel-failure · build-dsh-plugin` 与 `1/1`；
- 既有 `Author Evaluator` 仍弹出独立 paid disclosure，Cancel 返回原面板；
- 控制台 `0` error，预算卡无溢出。浏览器验收同时发现并修正了 fixture 的两个漏译工作流标签。

## 权限、卸载与限制

`automaticEvaluatorTargets` 是默认关闭的部署策略；启用只授权 P1.4 bounded correction/exact Skill 外发、一次可能付费 author 及其日额度。它不授权执行生成代码、qualification、Shadow、Promotion、merge、release、deploy、secret 读取或不可逆外部动作。禁用/卸载停止新自动 author；既有 Draft 仍由原 P1.9 控制面处理或手工删除，原生 DSH 可继续启动。

尚未证明真实 provider 的 evaluator qualified rate、semantic rejection rate、每次减少返工的净收益、陌生用户可用性或生产多日稳定性；因此只能声明 `implemented`，不能声明“自动 evaluator 已可信”或“优于 Hermes”。

最终 `pnpm check` 通过：Doctor 5/5、Software Delivery 26 passed / 1 skipped、Telegram 37/37、Evolve 184 passed / 2 skipped、Web 10/10；合计 262 passed / 3 skipped。全部文档链接、typecheck、build、Typert source digest、纯 Node artifact 与 `git diff --check` 同时通过。首次全仓并行复跑再次遇到既有 Telegram fixture 在 `dist` 清理时的竞态；独立 build + 37/37 与随后完整检查均通过，本片未修改 Telegram 或 DSH 行为。
