# ADR-0012：Software Delivery 从原生 Skill 加确定性验证器开始

## 状态

Accepted，2026-08-16。

## 背景

软件开发用户需要把 DSH 原生 Goal 交付成隔离、已验证、可审查的 Git commit，并可选择创建 Draft PR。DSH 已有 Goal、Skill、Shell、Sandbox 和 Approval；EvoForge 不应为线性开发流程建立 Mission、DAG、第二套执行器或动态 Tool 集合。

自进化下一步又需要一种比“模型说完成了”更可靠的真实 outcome。首个结果必须足够小，能在关闭 `dsh-evolve` 时独立使用，也不能为尚不存在的多个消费者预建公共服务。

## 决策

`dsh-software-delivery` 第一纵切只包含：

1. 一个通过 `ctx.skills.register()` 注册的稳定 `software-delivery` Skill；
2. 一个无 shell、精确 argv、输出有界的 `dsh-delivery verify` CLI；
3. 一个只有 `passed | failed | unknown`、reason、Git commit artifact 和 checks 的 JSON 结果。

Skill 指导 Agent 复用原生 Goal 和 Shell 完成 worktree、编辑、检查、commit 与可选 Draft PR。验证器要求 linked worktree、named branch、base 为 HEAD 祖先、至少一个 commit、检查前后 clean，且检查期间 HEAD/base 不漂移。

不增加 Evolve 依赖、公共 Service、模型 Tool、system prompt 或持久化数据库。等 `dsh-evolve` 成为第二个真实消费者并获得真实使用数据后，再决定结果读取是否值得形成公共 Adapter seam。

## 结果

- 正常模型表面只增加一个稳定 Skill catalog entry；正文沿 DSH 原生路径按需加载。
- 验证器能提供可复核的 commit/check outcome，但首版不拦截 Goal transition，不自动 push 或调用 GitHub。
- 验证配置是可信本地执行输入；剥离环境秘密和禁止 shell 不能把任意命令变成沙箱，实际权限仍由外围 DSH Shell/Sandbox/Approval 决定。
- 删除插件会同时移除 Skill；没有自有持久状态需要迁移。
- 这条窄实现不足以宣称 Software Delivery 产品化完成，但先建立 canary/rollback 所需的客观结果基础。

后续 P2B.1 在不改变本 ADR 首个纵切结论的前提下，增加了一个复用原生 Shell 与
`update_goal` 的受验证完成动作；见 [ADR-0013](0013-verified-completion-delegates-native-tools.md)。
