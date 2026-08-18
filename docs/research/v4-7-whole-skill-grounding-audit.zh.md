# V4-7 whole-Skill 研究与组合增量审计

> 核验日期：2026-08-18
> 用途：约束“官方资料/开源证据 → whole-Skill Candidate”的下一实现切片；不是完成声明。

## 本次固定的一手 revision

| 项目 | 2026-08-18 实时观测 revision | 与设计相关的事实 |
|---|---|---|
| DeepSeek Harness | 官方 `master` `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`；本仓兼容检出仍为 `47f943859bef60e4160492346772ded9b24f765a` | 两者间 Jobs、Storage Domain、Session 与 Web seam 的相关源码 API 未变，只有包版本前移到 rc.7；V4-7 继续组合 `ctx.web`/Jobs/Storage，不直连具体搜索或抓取 provider。 |
| Hermes Agent | `e02d1e41fc6104187e20af9eac8b2820566e3508` | 相比上一锁定点，最新变更主要是 Desktop 浏览器、Bot Mode 群组/线程与工具大结果 spillover；Skill 学习核心路径没有新的独立 holdout/发布证据门。 |
| Hermes Self-Evolution | `0a929e3aa20e15cf04dc7c28492a7d41a5139125` | 仍以 `SKILL.md` 优化为主；不作为 whole-folder 交付实现模板。 |
| OpenClaw | `d412c6b284e4e000d27b9d4a849fc46b05f54546` | Workshop 候选按完整文件 hash/tree hash 绑定，隔离 reviewer 不能 apply；`skill_proposal_evaluate` 读不可变 Candidate bundle 并记录 evaluator 归因。但它的 `auto` 仍可在 scanner 后直接写 live Skill，不等价于 EvoForge 所需 paired rollout/holdout 胜出。 |
| HanaAgent (`openhanako`) | `c6d0405294be67cb134c2758f6472748ee73e2be` | Skill 是标准 `skills/*/SKILL.md`；插件支持文件夹/zip 安装、私有数据与 restricted/full-access 分层，但 restricted 代码仍在主进程运行，不是代码级沙箱。 |
| SkillHone | `7d565839fb4dc74f9c77f09ace660e1c0484e048` | 明确把 `SKILL.md + scripts + references` 整文件夹当作原子变更单位，并以代码路径/文件权限分离 eval 与 Skill。当前公开的是可执行 Skill bundle，论文中的企业 harness 并未开源，不能把 README 当成可复用引擎。 |
| OpenSkill | `9de2f520567318514bfedceb39f4c0e974501246` | 提出从 docs/repos/Web 同时取得 knowledge 与 independent verification anchors，用 virtual tasks 迭代并将 target-task supervision 保留给 final evaluation；仓库仍明示“Code coming soon”，只能采用方法约束，不能声称复用已开源实现。 |

一手链接：[DSH](https://github.com/deepseek-ai/deepseek-harness/tree/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca) ·
[Hermes](https://github.com/NousResearch/hermes-agent/tree/e02d1e41fc6104187e20af9eac8b2820566e3508) ·
[Hermes Self-Evolution](https://github.com/NousResearch/hermes-agent-self-evolution/tree/0a929e3aa20e15cf04dc7c28492a7d41a5139125) ·
[OpenClaw Self-learning](https://docs.openclaw.ai/tools/self-learning) ·
[OpenClaw evaluator hook](https://docs.openclaw.ai/plugins/hooks#skill-lifecycle-and-evaluation) ·
[HanaAgent plugins](https://github.com/liliMozi/openhanako/blob/c6d0405294be67cb134c2758f6472748ee73e2be/PLUGINS.md) ·
[Agent Skills specification](https://agentskills.io/specification) ·
[SkillHone](https://github.com/Tencent/SkillHone/tree/7d565839fb4dc74f9c77f09ace660e1c0484e048) ·
[OpenSkill](https://github.com/OpenLAIR/OpenSkill/tree/9de2f520567318514bfedceb39f4c0e974501246)。

## V4-7 不可缩减的实现边界

1. **先研究，后生成**：由 DSH `ctx.web` seam 进行有界 search/fetch，每份证据保存 query hash、请求/最终 URL、来源角色、内容摘要和截断标记。不导入具体 provider，不使用浏览器 cookie，不向 Candidate 暴露凭据。
2. **知识与验证锚分开**：knowledge 可进入 proposer 的有界输入；verification anchor/holdout 由治理面持有，proposer 不可读。目标 Goal 的 gold/outcome 不能被改写成练习题。
3. **Host 组装整包**：模型只能返回一个有界 text-file manifest；Host 重新验证 exact Skill identity、相对路径、UTF-8、文件数/单文件/总字节、内部引用，再以确定性顺序生成 archive。不接受模型直接返回 base64 archive。
4. **首切片禁止可执行内容**：Agent Skills 允许 `scripts/`，但它会改变权限与安全等级。首个 whole-Skill 组合只允许根 `SKILL.md` 和一层 `references/*.md`；`scripts/`、二进制、symlink、可执行 mode 和未声明外部副作全部 fail closed。
5. **候选不能自证**：整包按 artifact digest + tree hash + model/input/research lineage 内容寻址，始终 `quarantined/inactive/unevaluated/never-executed`。现有 admission、assembled Shadow、holdout、Retention、review 和 future-Session promotion 规则不降级。
6. **有界迭代而非自改死循环**：每个 exact Candidate revision 最多一次 proposer 调用；后续修订必须绑定 exact 旧 tree hash 和新的归因证据，仍受每日预算、单 Skill inflight 门与不确定结果禁止盲重试的约束。

## 下一个可证伪纵切

“确定性 text-only whole-Skill 组装器”现已作为
[V4-7 第一个实现证据](../evidence/v4-7-whole-skill-composition.zh.md)交付：输入是经 Host 校验的
`SKILL.md + references/*.md` manifest，输出是可由现有 archive decoder 反向重放并得到同一 tree hash
的内容寻址 Candidate。该切片本身不使用 Web 证据、不运行脚本、不触发 admission/release，
只封死“模型产生什么形状、Host 如何原子封装”的供应链边界。下一个纵切将 DSH Web 研究证据包、
独立 verification anchors 与 whole-Skill manifest author 接入，同时保持 Candidate 不可执行、不发布。
