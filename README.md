# dsh-evoforge

[English](README.en.md) · [当前实现状态](docs/status.zh.md) · [开始参与](docs/getting-started.zh.md) · [研究报告](docs/research/README.zh.md)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 out-of-tree 开源扩展套件。EvoForge 只增加可独立安装、可删除的新能力，不 fork DSH，也不以插件修补 DSH Core Defect。

> **Pre-alpha：不可用于生产自动激活。** `dsh-evolve` 的 P0A/P0B/P0C、P1.1 最窄自动晋升、P1.2 反事实 canary/自动回滚、P1.3 显式反馈入口、P1.4 私有 Feedback Case Draft 和 P2D.1 交付 Outcome 已实现；`dsh-software-delivery` 的 Skill、Git 验证器、原生 Goal 受验证完成和幂等 Draft PR 也已实现。把 Draft 编译成可重放且有评分的 Case、真实任务误晋升/误回滚数据、用户可用性门与生产多日证据仍未完成。详见[状态页](docs/status.zh.md)。

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

仓库目前包含两个可独立删除、仍在开发的包：

| 包 | 当前能力 | 状态 |
|---|---|---|
| [`dsh-evolve`](packages/dsh-evolve) | 离线 `shadow`；durable resident recovery；Sealed paired Trial；immutable Generation；Session-scoped Git Skill；host-only review/pause/release；opt-in clear-instruction auto promotion；交付 Outcome、显式反馈/私有 Case Draft 与反事实 canary | P0A/P0B/P0C + P1.1–P1.4 + P2D.1 implemented；真实任务安全率与可用性门待验证 |
| [`dsh-software-delivery`](packages/dsh-software-delivery) | 按需原生 Skill；linked worktree/commit/check 验证；原生 Shell policy 下幂等 push/Draft PR；通过后完成 exact native Goal | P2A.1 + P2B.1 + P2C.1 implemented；Evolve 第二消费者已接通 |

Shadow 和未激活 Generation 的运行时模型表面为 `none`，额外 token 为 `0`。Generation 激活后只复用 DSH 原生 Skill catalog/body 路径：catalog 在 Session 开始时固定，正文按需加载；插件不增加 Tool 或 system prompt。真实 Agent 回归已证明晋升后旧 Session 的请求工具面不变、后一请求保留前一请求的完整消息前缀。Shadow 只有在用户显式调用时才请求配置的模型。

P1.1 policy、自动发布和 host 状态同样是 `0` 模型调用；自动候选最多追加 2 KiB Skill 正文，且只在 future Session 通过原生 Skill body 路径实际加载时产生 tokenizer 相关输入。它不会改写当前 Session 的可缓存前缀。

P2D.1 被动观察 DSH 最终 `tools/result`，把 Software Delivery 的三态结果关联到该 Session 已固定的 Generation。它异步保存最多 1000 条最小信号，`/evolve status` 只在 host plane 显示聚合；不保存 Prompt、仓库路径、PR 正文或 check 输出，不增加任何模型 token。P1.3 同样复用 DSH 原生 Message Feedback：只有带备注的当前负反馈形成可撤回引用，note、note hash、cwd 和消息正文均不复制。P1.4 只有在配置私有 `feedbackDraftRoot` 且用户逐条执行 draft 命令后，才复制一个直接用户文本和 correction，并绑定 exact Generation Skill；它仍不是已评分的可重放 Case。P1.2 只把匹配交付失败当作异步 canary 触发器：复用原 Case Pack 和 exact Git parent/Candidate，只有 parent pass / Candidate fail 的可归因反事实成立且 active 未变化才回滚 future Session。它不调用 proposer，模糊结果进入 review。

`dsh-software-delivery` 的 Skill 正文仍按原生路径按需加载；完整 Goal/Shell composition 只增加一个稳定 `complete_delivery` Tool，无 system prompt。其序列化 Schema 被测试限制在 2 KiB 内，同一 Session 的重复请求 Tool surface 完全相等。CLI 在模型上下文外运行；Tool 只在实际调用时返回有界的 commit/check 证据。

当前命令：

```text
dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir> [--resume]
/evolve [status|feedback [<64-char-signal-id> [draft <skill>]]|review [<64-char-review-id> [approve|reject <note>]]|pause|resume|promote <64-char-generation-id>|rollback]
```

它可以可靠拒绝越出 owned Skill 的候选；带完整 Case Pack 时，先用 known-bad/known-correction 校准 evaluator，再在四个相互独立的 macOS Sealed Trial 中比较 baseline 与 Candidate。证据不足、预算超限、平台无隔离器或 active/Case Pack 漂移时返回 `2 + incomplete`。

## 本地验证

需要 Node.js `^22.19.0 || >=24` 与 pnpm `11.7.0`：

```bash
pnpm install
pnpm check
pnpm --filter dsh-evolve pack --pack-destination "$PWD/.evoforge/pack"
pnpm --filter dsh-software-delivery pack --pack-destination "$PWD/.evoforge/pack"
```

当前测试跨越真实 CLI 子进程、HTTP 模型边界、文件系统效果、退出码和报告文件；macOS assembled lane 还会启动固定 revision 的真实 DSH Loader、Agent Loop、Skill、ToolRuntime、Storage 与 bash Tool。外部模型由无密钥固定 Adapter 替换，DSH 下游装配和文件效果不 mock。

如果要手工运行，请先阅读[开始参与](docs/getting-started.zh.md)和公开[示例 Case Pack](examples/case-packs/browser-e2e-guidance)。该命令可能调用付费模型，必须由调用者显式配置预算和凭据。

## 尚未实现

- 多个独立真实 case、真实 provider 提案效果、Linux/Windows 隔离与 workspace 磁盘配额；
- 逐行 diff viewer、真实人工可用性数据，以及真实任务上的 false-promotion/false-rollback/review rate（最窄 allowlist 自动晋升、outcome、显式反馈、私有 Case Draft 和反事实自动回滚已实现；Draft 到可重放 Case/Candidate 尚未实现）；
- 生产多日 soak、真实磁盘耗尽与大规模 run 性能数据（常驻 native Jobs supervisor、自动扫描和关机恢复已实现）；
- `dsh-software-delivery` 不做全局 Goal 拦截；原生直接 `update_goal` 仍可用。Draft PR 首片只支持 GitHub.com 同仓分支，尚缺 fork/其他 forge 和 CI 等待；Evolve canary 尚缺真实开发任务长期数据；个人助理、消息、内容和日程插件也未实现；
- Web/TUI 控制面。

这些能力不会仅凭设计文档被标为完成。每个阶段必须满足[路线图退出条件](docs/roadmap.zh.md)和[Hermes 上位目标记分卡](docs/architecture/hermes-replacement-scorecard.zh.md)。

## 文档地图

- [当前实现状态](docs/status.zh.md)：implemented、verified、planned 的严格区分；
- [开始参与](docs/getting-started.zh.md)：环境、命令、Case Pack 输入和退出语义；
- [需求基线](docs/requirements.zh.md)：产品目标、授权边界与工作顺序；
- [领域语言](CONTEXT.md)：Candidate、Trial、Generation、Cache Contract 等统一术语；
- [产品架构](docs/architecture/evoforge-product.zh.md)与[自进化架构](docs/architecture/evolution-design.zh.md)；
- [P0A Shadow 契约](docs/architecture/p0a-shadow-contract.zh.md)；
- [DSH 全量 171 插件目录](docs/research/deepseek-harness-native-plugins.zh.md)；
- [DSH、Claude Code Rev、Hermes 深度调研与比较](docs/research/README.zh.md)；
- [插件接口与验收规范](docs/plugin-contract.zh.md)；
- [DSH 插件开发 Skill](skills/build-dsh-plugin/SKILL.md)。

## 参与项目

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。新增能力必须在“DSH 完全正确”时仍有独立用户价值，并明确模型表面、KV Cache、权限、持久状态、卸载和验证证据。DSH 自身缺陷请提交给上游，不在本仓库长期维护 workaround。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告；使用范围与支持边界见 [SUPPORT.md](SUPPORT.md)。

## 许可证

[MIT](LICENSE)
