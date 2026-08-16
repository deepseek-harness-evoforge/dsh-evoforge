# dsh-evoforge

[English](README.en.md) · [当前实现状态](docs/status.zh.md) · [开始参与](docs/getting-started.zh.md) · [研究报告](docs/research/README.zh.md)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 out-of-tree 开源扩展套件。EvoForge 只增加可独立安装、可删除的新能力，不 fork DSH，也不以插件修补 DSH Core Defect。

> **Pre-alpha：不可用于生产自动激活。** `dsh-evolve` 的 P0A/P0B/P0C（含 exact diff、protected-effect 词法提示和真实 DSH Web 控制面）、P1.1 最窄自动晋升、P1.2 反事实 canary/自动回滚、P1.3 显式反馈入口、P1.4 私有 Feedback Case Draft、P1.5 反馈引导 Shadow、P1.6 proposer 前 Case Pack 校准、P1.7 evaluator authoring Skill、P1.8 显式 Feedback Shadow Launch、P1.9 私有 Evaluator Draft/人工资格验证、P1.10 Qualified Shadow Handoff、P1.11 exact Retention Gate、P1.12 opt-in Retention 自动晋升门、P1.13 静态 Automatic Retention Target、P1.14 opt-in Automatic Feedback Shadow、P1.15 持久自动进化日预算、P1.16 opt-in Automatic Evaluator Draft、P1.17 人工 Qualify-and-Shadow 和 P2D.1 交付 Outcome 已实现；`dsh-software-delivery` 的受验证交付闭环、`dsh-doctor` 的零 Token Runtime Readiness 与 `dsh-telegram` 的单私聊 Agent Adapter 也已实现。默认开启的后台 evaluator author、自动 evaluator qualification、真实任务误晋升/误回滚数据、陌生用户可用性门与生产多日证据仍未完成。详见[状态页](docs/status.zh.md)。

## 为什么做

现有 Agent 可以反思、改写 Skill，甚至持续运行，但“发生了修改”不等于“能力真的变好”。`dsh-evolve` 的目标是把自进化变成一条可验证的能力发布链：

```text
真实结果 → inactive Candidate → sealed paired Trial
        → promote / review / reject → 仅未来 Session 生效 → 可回滚
```

它必须同时守住四个边界：

- **证据优先**：模型反思只产生候选，不能证明改进；
- **会话不漂移**：active Session 固定 Capability Generation；
- **默认可逆**：候选不原地修改 active Skill，每个版本可定位和回滚；
- **KV Cache 优先**：后台状态不进入正常 Session 的动态 system prompt、Tool Schema 或 Skill catalog。

## 现在已经有什么

仓库目前包含五个可独立删除、仍在开发的包：

| 包 | 当前能力 | 状态 |
|---|---|---|
| [`dsh-evolve`](packages/dsh-evolve) | 离线 `shadow`/零模型 Case Pack 校准；exact Candidate 保留旧能力门、opt-in 自动晋升绑定、单静态 prior Target、明确纠错自动 Shadow、全新失败自动 inactive Evaluator Draft 与 crash-safe 日预算；durable resident recovery；Sealed paired Trial；immutable Generation；Session-scoped Git Skill；含 exact diff/词法影响提示的 host-only review；pause/release；交付 Outcome、私有 Case Draft/Evaluator Draft、人工 Qualify-and-Shadow、evaluator authoring Skill 与反事实 canary | P0A/P0B/P0C + P1.1–P1.17 + P2D.1 implemented；真实 provider/任务安全率与可用性门待验证 |
| [`dsh-evolve-web`](packages/dsh-evolve-web) | 一条可删除 Bundle 安装 host + Web；无 Session 可达的全局入口；显式 Feedback Shadow/Evaluator Author/Qualified Shadow；可选一次确认 Qualify-and-Shadow；有界 evaluator/review/diff；pause/resume/qualify/reject/promote/rollback | P0C.6 + P1.8–P1.10 + P1.17 implemented；固定 DSH tarball、浏览器 RPC、跨重启 pause/resume 与付费/执行确认已验收，陌生用户数据待补 |
| [`dsh-software-delivery`](packages/dsh-software-delivery) | 按需原生 Skill；linked worktree/commit/check 验证；原生 Shell policy 下幂等 push/Draft PR；可选 exact-head 远端 checks 门；通过后完成 exact native Goal | P2A.1 + P2B.1 + P2C.1–P2C.2 implemented；Evolve 第二消费者已接通 |
| [`dsh-doctor`](packages/dsh-doctor) | 一条可删除 Bundle；把当前原生 Loader 状态归约为三态 Runtime Readiness、具体阻塞插件和下一步动作；只诊断、不修复 | implemented；真实 tarball add/dump-config/boot/remove 已通过，陌生用户诊断成功率待验证 |
| [`dsh-telegram`](packages/dsh-telegram) | 把一个静态授权的 Telegram 私聊连接到一个稳定 DSH Agent；复用原生 Commands/Approval/Goal/Schedule，以 durable journal 防止不确定发送盲目重试 | AS-1 implemented；真实 Loader/Agent Loop、429、Approval callback、Storage 重启和 tarball add/boot/remove 已通过，真实 Bot soak 与 Hermes paired benchmark 待验证 |

Shadow 和未激活 Generation 的运行时模型表面为 `none`，额外 token 为 `0`。Generation 激活后只复用 DSH 原生 Skill catalog/body 路径：catalog 在 Session 开始时固定，正文按需加载；插件不增加 Tool 或 system prompt。[64 轮真实 Agent 对照](docs/evidence/kv-1-long-session-request-stability.zh.md)已证明：完整进化配置和中途 future-Generation pointer 变化下，当前 Session 的每一轮模型可见请求仍与未安装 EvoForge 的控制组序列化等价，且后一请求保留前一请求的完整前缀。默认只有用户显式调用才会请求进化模型；P1.14/P1.16 仅在部署者另行配置 exact 自动 Target 时分别允许 Shadow proposer 或 inactive evaluator author，并由 P1.15 的静态 UTC 日 cap 限制。

P1.1 policy、自动发布和 host 状态同样是 `0` 模型调用；自动候选最多追加 2 KiB Skill 正文，且只在 future Session 通过原生 Skill body 路径实际加载时产生 tokenizer 相关输入。它不会改写当前 Session 的可缓存前缀。

P0C.5 在每次 review detail 中显示固定版本的 protected-effect 词法提示。它只扫描 exact baseline
相对 Candidate 的变更文本，复用 P1.1 的保守路由规则；否定句仍会提示，未命中也不是安全证明。
该投影完全位于 host plane，DSH Approval/Permission/Sandbox 仍是外部效果的权威边界。

P0C.6 用 `dsh-evolve-web` 把同一权威控制模块接到 DSH 原生 Web。入口位于全局侧栏，无 Session 也可用；只在打开、刷新或动作后读取，没有后台轮询。review detail 同屏显示 claim、changed files、判定理由、限制、case、成本、词法影响和 exact diff；approve/reject 后立即关闭过期表单。approve 后的 inactive Generation 从 durable review evidence 投影，刷新或进程重启后仍可继续 promote。真实固定版本 DSH 已通过 tarball 安装、Client Module/RPC、浏览器 pause→重启仍暂停→resume 验收；[可解释审查卡](docs/evidence/ui-1-explainable-review.zh.md)另经真实 Chrome 审批闭环验证。它不新增模型可见表面，正常 Session token 增量为 `0`。

P1.8 把“已有明确纠正”到“一次后台 Shadow”接进同一 Commands/Web 控制面。操作者预先把公开 target id 静态绑定到 exact Skill、已校准 Case Pack 和 owned run root；用户每次仍要明确确认一次可能付费的 proposer 请求和受限纠正文案外发。浏览器与命令不能提交路径或模型参数，调用立即返回原会话，重复调用复用内容寻址 launch 与 durable journal。它不自动生成 evaluator、不自动晋升，也不增加正常 Session token。

P1.9 为尚无可信 Case Pack 的明确纠正增加同一入口下的受限 authoring。host 固定 known-bad、manifest、
预算和 pinned DSH revision，模型只能提议 evidence、known-correction 与 evaluator；生成结果先进入私有
inactive Draft。另一项人工 exact-hash 审查才授权 sealed qualification，通过后也只得到 Qualified
Case Pack，不自动 Shadow 或晋升。正常 Session token 增量为 `0`；新的 launch 最多一次独立 author
请求，输出上限 1600 token，`SIGKILL`/transport 不确定时不自动重复付费。

P1.10 消除 Qualified Case Pack 的手工路径死端。Evaluator Target 可选绑定一个既有 supervisor
run root；用户必须再确认一次付费与受限纠正外发，host 才把 journal 中的 exact qualified hash
交给同一个 P1.8 Shadow launcher、原生 Jobs 与 durable journal。它不会自动启动、不会直达 Candidate
或 Promotion；普通 Session 的模型表面和 token 增量仍为 `0`。

P1.11 增加最小的抗遗忘证据门。用户把一个已完成、可审查的 exact Shadow Candidate 与一个独立的
历史可信 Case Pack 显式交给 `retain`；它复用 sealed calibration 与 baseline/Candidate paired Trial，
返回 `retained`、`regressed` 或 `incomplete`。它不再调用 proposer、不生成 Candidate、不修改 active
Skill，也不自动晋升。一次完整调用固定执行四次 evaluator Trial；assembled evaluator 自身的模型调用
与 usage 是单独成本，若有会进入报告，不能与“零 proposer”混为一谈。普通 Session token 增量仍为 `0`。

P1.12 可选把 P1.11 证据接入 P1.1 clear-win 自动晋升。启用静态 `retentionRoots` 后，缺失、
incomplete、regressed、篡改、symlink 或相互冲突的报告都让 Candidate 留在既有人工 review；至少一个
exact `retained` 且无 evidence warning 才能自动激活 future Session。它只读本地有界报告，复用既有
supervisor 重评，不自动运行 Retention、不阻断人工 promote，也不新增模型调用或 Session token。

P1.13 可再为每个 allowlisted Skill 配置一个静态 exact `retentionTargets` entry。这项部署策略授权既有
supervisor 只对原本已经满足 clear-win 的 Candidate，通过 native Jobs 自动执行一次 P1.11；每轮最多
一个，`retained` 才继续晋升，`regressed|incomplete|uncertain` 均留在 review。Trial 创建 output 后
若崩溃绝不自动重试，避免重复 evaluator/model 费用；它没有新增 Session surface，普通请求 token 增量为 0。

P1.14 可再用 `automaticFeedbackTargets` 把一条“明确负反馈 + 非空纠正”接到一个已有、静态且
exact-hash 的 P1.8 Target。配置同时授权最小私有 Draft copy、一次 proposer/evaluator 成本与受限纠正
外发；每轮最多启动一个，零匹配或多匹配保持人工选择。它复用既有 Jobs/journal/Review/Retention/
Promotion；`proposal-pending` 绝不自动重发，原 Session 永不等待且保持旧 Generation。没有可信 Case
Pack 时仍走 P1.9 人工语义资格验证，proposer 不能自己当裁判。普通 Session token 增量仍为 0。

P1.15 为每个自动 Target 增加默认 `1`、最大 `20` 次/UTC 日的持久尝试上限。可能付费的启动前先在
owned run root 原子预留；崩溃后同一 Signal 复用额度，额度耗尽只延后自动入口，原 Session 和逐次
人工 Shadow 继续可用。`/evolve status` 与 Web 只投影 bounded `used/limit/remaining`；journal 每个
Target 恒定为一个最多 20 项的 `current.json`，正常 Session token 增量仍为 `0`。

P1.16 可用 `automaticEvaluatorTargets` 为尚无可信 Case Pack 的静态 Skill 预授权一次 bounded
evaluator author。明确纠正会先消费日预算，再进入既有私有、不可执行 Draft inbox；人工 qualification、
Shadow 与 Promotion 仍是独立权限。一个 Skill 不能同时配置 P1.14 与 P1.16，避免同一纠正触发两次
外部调用。原 Session 不等待，普通请求 token 增量为 `0`。

P1.17 在人工已经读完 exact Draft 后提供可选的一次 `qualify-shadow` 动作：sealed qualification
失败则 proposer 请求为 `0`；成功才复用 P1.10 的内容寻址 Shadow。原有分步 qualification/Shadow
仍保留，Promotion 继续是独立权限，普通 Session token 增量仍为 `0`。

P2D.1 被动观察 DSH 最终 `tools/result`，把 Software Delivery 的三态结果关联到该 Session 已固定的 Generation。它异步保存最多 1000 条最小信号，`/evolve status` 只在 host plane 显示聚合；不保存 Prompt、仓库路径、PR 正文或 check 输出，不增加任何模型 token。P1.3 同样复用 DSH 原生 Message Feedback：只有带备注的当前负反馈形成可撤回引用，note、note hash、cwd 和消息正文均不复制。P1.4 只有在配置私有 `feedbackDraftRoot` 且用户逐条执行 draft 命令后，才复制一个直接用户文本和 correction，并绑定 exact Generation Skill。P1.5 允许用户把该草稿显式交给一次 Shadow，只引导 proposer；既有校准 Case Pack 仍是独立裁判，草稿字段不被直接复制到 run evidence（proposer 若在 Candidate 中回显，输出仍会持久化）。P1.6 可用独立零模型命令验证 Case Pack 方向；完整 Shadow 也先校准、再请求 Candidate，失准 evaluator 的 proposer token 为 0。P1.2 只把匹配交付失败当作异步 canary 触发器：复用原 Case Pack 和 exact Git parent/Candidate，只有 parent pass / Candidate fail 的可归因反事实成立且 active 未变化才回滚 future Session。它不调用 proposer，模糊结果进入 review。

`dsh-software-delivery` 的 Skill 正文仍按原生路径按需加载；完整 Goal/Shell composition 只增加一个稳定 `complete_delivery` Tool，无 system prompt。其序列化 Schema 被测试限制在 2 KiB 内，同一 Session 的重复请求 Tool surface 完全相等。可选 `requireDraftPrChecks` 只在 host plane 改变调用后的完成门，不改变 Tool Schema；它单次读取 exact PR head 的远端 checks，不轮询、不复制 CI 日志。CLI 在模型上下文外运行；Tool 只在实际调用时返回有界的 commit/check 证据。

`dsh-telegram` 不建通用 Gateway，只绑定一个 exact private chat/user 与一个带稳定 `sessionId` 的
既有 Agent。该 Agent 的完成 turn（含 Goal/Schedule continuation）回到 Telegram；原生 Command 不
调用模型，一次性 Approval callback fail closed。插件注册 0 Tool/Skill/Prompt，空闲与普通 Session
增加 0 token；独立 Storage Domain 先记录发送意图，只有 Telegram 明确 `429 + retry_after` 才有界
重试，transport 或 crash-in-send 标为 `uncertain`。终态 journal 有硬容量上限，卸载不向原生 Session
留下不可识别事件。

当前命令：

```text
dsh-evolve calibrate --case-pack <case-pack-dir> --output <new-run-dir>
dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir> [--feedback-draft <private-draft.json>] [--resume]
dsh-evolve retain --run <completed-shadow-run> --case-pack <prior-case-pack-dir> --output <new-run-dir>
/evolve [status|feedback [<64-char-signal-id> [draft <skill>|shadow <target>|author <evaluator-target>]]|evaluator [<64-char-draft-id> [approve|reject <note>|shadow]]|review [<64-char-review-id> [approve|reject <note>]]|pause|resume|promote <64-char-generation-id>|rollback]
/doctor
/telegram
```

它可以可靠拒绝越出 owned Skill 的候选；带完整 Case Pack 时，在 proposer 前先用 known-bad/known-correction 校准 evaluator，再比较 baseline 与 Candidate，完整成功路径仍是四个相互独立的 macOS Sealed Trial。证据不足、预算超限、平台无隔离器或 active/Case Pack 漂移时返回 `2 + incomplete`。

## 本地验证

需要 Node.js `^22.19.0 || >=24` 与 pnpm `11.7.0`：

```bash
pnpm install
pnpm check
pnpm --filter dsh-evolve pack --pack-destination "$PWD/.evoforge/pack"
pnpm --filter dsh-evolve-web pack --pack-destination "$PWD/.evoforge/pack"
pnpm --filter dsh-software-delivery pack --pack-destination "$PWD/.evoforge/pack"
pnpm --filter dsh-doctor pack --pack-destination "$PWD/.evoforge/pack"
pnpm --filter dsh-telegram pack --pack-destination "$PWD/.evoforge/pack"
```

当前测试跨越真实 CLI 子进程、HTTP 模型边界、文件系统效果、退出码和报告文件；macOS assembled lane 还会启动固定 revision 的真实 DSH Loader、Agent Loop、Skill、ToolRuntime、Storage 与 bash Tool。外部模型由无密钥固定 Adapter 替换，DSH 下游装配和文件效果不 mock。

如果要手工运行，请先阅读[开始参与](docs/getting-started.zh.md)和公开[示例 Case Pack](examples/case-packs/browser-e2e-guidance)。该命令可能调用付费模型，必须由调用者显式配置预算和凭据。

## 尚未实现

- 多个独立真实 case、真实 provider 提案效果、Linux/Windows 隔离与 workspace 磁盘配额；
- 真实人工 review/evaluator qualification 可用性数据、语义级 capability/权限差异审计和可选分页/图形 diff，以及真实任务上的 false-promotion/false-rollback/review rate；私有与 opt-in 自动生成的 inactive Evaluator Draft 已实现，但仍缺真实 provider 的 qualified rate、semantic rejection rate、成本与后续改善率；
- 生产多日 soak、真实磁盘耗尽与大规模 run 性能数据（常驻 native Jobs supervisor、自动扫描和关机恢复已实现）；
- `dsh-software-delivery` 不做全局 Goal 拦截；原生直接 `update_goal` 仍可用。Draft PR 首片只支持 GitHub.com 同仓分支；可选门能读取 exact-head 全量 checks，但尚缺 fork/其他 forge、required-only 规则、CI 日志诊断和自动等待；Evolve canary 尚缺真实开发任务长期数据；消息侧只实现一个 Telegram 私聊，真实 Bot 多日 soak、其他渠道、内容和日程插件尚未实现；
- TUI 控制面；Web 首版已实现，但尚无陌生用户 approve/promote/rollback 可用性数据、实时推送或分页/图形 diff。

这些能力不会仅凭设计文档被标为完成。每个阶段必须满足[路线图退出条件](docs/roadmap.zh.md)和[Hermes 上位目标记分卡](docs/architecture/hermes-replacement-scorecard.zh.md)。

## 文档地图

- [当前实现状态](docs/status.zh.md)：implemented、verified、planned 的严格区分；
- [开始参与](docs/getting-started.zh.md)：环境、命令、Case Pack 输入和退出语义；
- [需求基线](docs/requirements.zh.md)：产品目标、授权边界与工作顺序；
- [领域语言](CONTEXT.md)：Candidate、Trial、Generation、Cache Contract 等统一术语；
- [产品架构](docs/architecture/evoforge-product.zh.md)与[自进化架构](docs/architecture/evolution-design.zh.md)；
- [P0A Shadow 契约](docs/architecture/p0a-shadow-contract.zh.md)；
- [P1.11 Exact Retention Gate 契约](docs/architecture/p1-11-exact-retention-gate.zh.md)；
- [P1.12 Retention Auto-Promotion Gate 契约](docs/architecture/p1-12-opt-in-retention-auto-promotion-gate.zh.md)；
- [P1.13 Automatic Retention Target 契约](docs/architecture/p1-13-automatic-retention-target.zh.md)；
- [P1.14 Automatic Feedback Shadow 契约](docs/architecture/p1-14-automatic-feedback-shadow.zh.md)；
- [P1.15 Automatic Evolution Budget 契约](docs/architecture/p1-15-automatic-evolution-budget.zh.md)；
- [P1.16 Automatic Evaluator Draft 契约](docs/architecture/p1-16-automatic-evaluator-draft.zh.md)；
- [P1.17 Human-approved Qualify-and-Shadow 契约](docs/architecture/p1-17-human-approved-qualify-and-shadow.zh.md)；
- [DSH 全量 171 插件目录](docs/research/deepseek-harness-native-plugins.zh.md)；
- [DSH、Claude Code Rev、Hermes 深度调研与比较](docs/research/README.zh.md)；
- [插件接口与验收规范](docs/plugin-contract.zh.md)；
- [DSH 插件开发 Skill](skills/build-dsh-plugin/SKILL.md)；
- [全新失败 evaluator authoring Skill](skills/author-dsh-evolution-case/SKILL.md)。

## 参与项目

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。新增能力必须在“DSH 完全正确”时仍有独立用户价值，并明确模型表面、KV Cache、权限、持久状态、卸载和验证证据。DSH 自身缺陷请提交给上游，不在本仓库长期维护 workaround。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告；使用范围与支持边界见 [SUPPORT.md](SUPPORT.md)。

## 许可证

[MIT](LICENSE)
