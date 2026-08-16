# P1.9 私有 Evaluator Draft 与人工资格验证证据

> 结论：`implemented`，不是“自动 evaluator 已解决”，也不是生产可用声明
> 日期：2026-08-17

## 用户结果

用户已经对一次 Skill 失败给出明确纠正、但尚无可信 Case Pack 时，可以从同一个 `/evolve feedback`
入口显式提交一个静态 Evaluator Target。动作立即返回一个原生 Jobs receipt，原 Session 不等待。一次
有界模型请求只产生私有、不可执行的 Evaluator Draft；只有另一项人工语义审查批准 exact hash 后，
生成代码才会在 sealed runner 中执行 known-bad/known-correction 资格验证。通过后发布的是 immutable、
content-addressed Qualified Case Pack，不是 Candidate、Generation 或 Promotion 授权。

## 实现边界

- `EvaluatorDraftInbox` 单独拥有 author、scan、detail、approve、reject 与 durable run journal；Commands、
  Typert Remote 和 Web 只委托该深模块。
- 静态 `evaluatorTargets` 只允许公开 id、exact Skill、私有 absolute root 和 pinned DSH commit；浏览器与
  Command 不能提交 path、Prompt、模型、预算或凭据。
- host 固定写 `manifest.json` 和 exact known-bad `SKILL.md`；模型只提议 evidence、known-correction
  `SKILL.md` 与 `evaluator.mjs`。首片恰好五个文件，单文件 32 KiB、总计 64 KiB。
- 首片只接受一个 `SKILL.md` 的纯指令 Skill；多文件 tree、未知响应字段、路径漂移、hash 漂移和
  symlink owned root 全部 fail closed。
- Author 前持久化 `authoring-pending`。provider 已观察但 host 未观察结果时返回 `uncertain`，重启不
  自动重复付费请求；本地 qualification 失败可对同一 exact hash 使用新的 attempt 目录重跑。
- generated code 在 `draft-ready` 前后都不进入 Tool、Prompt、Skill 或 system message；批准前执行次数
  为 0。Qualified Pack 也不能自行启动 Shadow，后续仍需独立显式动作与现有 paired Trial。

## 验证结果

| 门 | 结果 |
|---|---|
| 单元与状态机 | 5 个固定文件、host-owned 内容、exact hash、漂移/未知字段/多文件/symlink 拒绝、付费歧义、qualification retry 通过 |
| OS 崩溃 | 独立 Node 进程在 `authoring-pending` 且 HTTP provider 已收到请求后被 `SIGKILL`；重启返回 `uncertain`，provider request count 仍为 1，API key 未进入 journal |
| 真实 DSH qualification | 人工 approve 后，生成的 evaluator 在 macOS seatbelt 内启动 pinned DSH headless Agent、按需装配 exact Skill、检查模型可见历史与 composition；known-bad fail、known-correction pass |
| KV Cache | 配置/不配置 Evaluator Target 的真实 DSH 正常 Agent 完整 model request 逐字段相等；没有 evaluator/target 文本泄漏，正常请求增量 0 token |
| 原生接缝 | 真实 DSH Message Feedback、Session Persistence、Commands、Jobs、Generation 与 Skill 路径完成 Author；一次独立后台模型请求，原 Agent request count 不变 |
| Control Plane | Commands、Evolution Control Plane、Typert Remote 与 Web 共用同一 authority；Remote 不返回 host path、反馈原文或模型配置 |
| 真实浏览器 | 使用 DSH Web 真实 React 组件完成 Evolution → Author disclosure → Cancel（无 Done）→ Author Confirm → Inspect files → note → sealed-execution Confirm → Done；两个危险动作使用不同确认文案 |
| 包边界 | `pnpm pack` 后在真实 DSH profile 中以 `evaluatorTargets` 配置 add/boot/dispose/remove，再启动 native DSH；native system composition 相等 |

关键自动化文件：

- `packages/dsh-evolve/test/evaluator-draft-inbox.test.ts`
- `packages/dsh-evolve/test/evaluator-authoring-crash.e2e.test.ts`
- `packages/dsh-evolve/test/generation-binder.e2e.test.ts`
- `packages/dsh-evolve/test/package-install-remove-generation.e2e.test.ts`
- `packages/dsh-evolve-web/test/evolution-action.client.test.tsx`

本次复现结果：`pnpm check` 通过；其中 `dsh-evolve` 142 passed / 2 skipped，Web 8/8，Telegram
37/37，Software Delivery 26 passed / 1 skipped，Doctor 5/5，并完成全部构建。更新后的 `pnpm
test:pa1` 为 Evolve 32/32、Web 7/7、Telegram 22/22、Software Delivery 22 passed / 1 skipped。
`dsh-evolve` 与 `dsh-evolve-web` 均成功生成可安装 tarball；真实 profile add/boot/remove 由上述包边界
测试覆盖。

## Token 与成本

- 未触发时、正常 Session、scan/detail/approve 控制请求：新增模型 token 为 `0`。
- 每次新的 exact Signal + Target + Skill tree + model route 最多一次 author 模型请求；host 固定
  `max_tokens=1600`，Case Pack manifest 的输入预算上限为 12,000。真实消耗由 provider usage 原样记录。
- sealed qualification 不调用 proposer。生成 evaluator 若需要验证 DSH model composition，应使用
  case 自带的确定性无密钥 Adapter；首版不授权它读取 secret、联网或触发付费 provider。
- 同一 launch 幂等复用；不确定外部结果不自动重试，避免 crash 造成双倍付费。

## 尚未证明

- 没有真实 provider 与真实用户纠正样本，因此没有 qualified rate、人工 semantic rejection rate、
  单个 Qualified Case Pack 的真实平均成本或后续 Candidate 改善率。
- calibration 只证明这个 exact evaluator 对声明的 known-bad/known-correction 方向正确；无法证明它覆盖
  新颖失败，也不能排除模型把 fixture 细节写死，所以人工语义审查不能取消。
- 只有 macOS seatbelt backend；Linux/Windows 隔离、磁盘配额、生产多日 soak 与陌生用户可用性未完成。
- Qualified Pack 仍须通过之后独立、显式、付费披露的 Feedback Shadow 和 paired Trial，不能直接晋升。

因此 P1.9 的准确表述是“显式、私有、受审查的 evaluator 起草与资格验证已实现”，不是“持续进化已
完美”或“优于 Hermes”。
