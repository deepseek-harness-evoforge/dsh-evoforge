# dsh-evoforge

[English](README.en.md) · [当前实现状态](docs/status.zh.md) · [开始参与](docs/getting-started.zh.md) · [研究报告](docs/research/README.zh.md)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 out-of-tree 开源扩展套件。EvoForge 只增加可独立安装、可删除的新能力，不 fork DSH，也不以插件修补 DSH Core Defect。

> **Pre-alpha：不可用于生产自动激活。** P0A Shadow、P0B Local Continuity 与 P0C 人工控制已实现；P1.1 增加默认关闭、显式 allowlist 的最窄纯指令自动晋升。canary、自动回滚、真实用户可用性门与生产多日证据仍未完成。详见[状态页](docs/status.zh.md)。

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

仓库目前包含一个正在开发的包：

| 包 | 当前能力 | 状态 |
|---|---|---|
| [`dsh-evolve`](packages/dsh-evolve) | 离线 `shadow`；durable resident recovery；Sealed paired Trial；immutable Generation；Session-scoped Git Skill；host-only review/pause/release；opt-in clear-instruction auto promotion | P0A/P0B/P0C implemented；P1.1 implemented；canary/自动回滚与真实可用性门待验证 |

Shadow 和未激活 Generation 的运行时模型表面为 `none`，额外 token 为 `0`。Generation 激活后只复用 DSH 原生 Skill catalog/body 路径：catalog 在 Session 开始时固定，正文按需加载；插件不增加 Tool 或 system prompt。真实 Agent 回归已证明晋升后旧 Session 的请求工具面不变、后一请求保留前一请求的完整消息前缀。Shadow 只有在用户显式调用时才请求配置的模型。

P1.1 policy、自动发布和 host 状态同样是 `0` 模型调用；自动候选最多追加 2 KiB Skill 正文，且只在 future Session 通过原生 Skill body 路径实际加载时产生 tokenizer 相关输入。它不会改写当前 Session 的可缓存前缀。

当前命令：

```text
dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir> [--resume]
/evolve [status|review [<64-char-review-id> [approve|reject <note>]]|pause|resume|promote <64-char-generation-id>|rollback]
```

它可以可靠拒绝越出 owned Skill 的候选；带完整 Case Pack 时，先用 known-bad/known-correction 校准 evaluator，再在四个相互独立的 macOS Sealed Trial 中比较 baseline 与 Candidate。证据不足、预算超限、平台无隔离器或 active/Case Pack 漂移时返回 `2 + incomplete`。

## 本地验证

需要 Node.js `^22.19.0 || >=24` 与 pnpm `11.7.0`：

```bash
pnpm install
pnpm check
pnpm --filter dsh-evolve pack --pack-destination "$PWD/.evoforge/pack"
```

当前测试跨越真实 CLI 子进程、HTTP 模型边界、文件系统效果、退出码和报告文件；macOS assembled lane 还会启动固定 revision 的真实 DSH Loader、Agent Loop、Skill 与 bash Tool。外部模型由无密钥固定 Adapter 替换，DSH 下游装配和文件效果不 mock。

如果要手工运行，请先阅读[开始参与](docs/getting-started.zh.md)和公开[示例 Case Pack](examples/case-packs/browser-e2e-guidance)。该命令可能调用付费模型，必须由调用者显式配置预算和凭据。

## 尚未实现

- 多个独立真实 case、真实 provider 提案效果、Linux/Windows 隔离与 workspace 磁盘配额；
- 逐行 diff viewer、真实人工可用性数据、future-session canary 与 outcome-triggered 自动回滚（最窄 allowlist 自动晋升已实现）；
- 生产多日 soak、真实磁盘耗尽与大规模 run 性能数据（常驻 native Jobs supervisor、自动扫描和关机恢复已实现）；
- `dsh-software-delivery`、个人助理、消息、内容和日程插件；
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
