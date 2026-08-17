# EvoForge 全仓原生插件形态审计

审计基线：DeepSeek Harness `47f943859bef60e4160492346772ded9b24f765a`（`0.1.0-rc.5`）的源码、官方 Bundle 样例、profile loader 与 `dsh plugin` CLI。结论以本次纠正后的工作树为准，同时记录纠正前发现。

## 纠正前的关键问题

- `dsh-evolve` 与 `dsh-software-delivery` 发布了 `dsh-evolve`/`dsh-delivery` bin，却没有 `dsh.bundle`；部分测试明确断言安装后的 Bundle 列表为空。
- 旧 package-boundary 路径直接运行产品 CLI 或源码，把仓库测试误当作 DSH 安装。
- `dsh-software-delivery`、`dsh-doctor`、`dsh-evolve-web` 缺少完整 runtime `Config`；多个 Bundle 没有导出 patch 文件。
- dev dependency 漂到 rc.6，文档却没有区分“本地类型依赖”和“固定 rc.5 assembled 支持证据”。
- 活跃 README/getting-started 把 Shadow/verifier CLI 写成用户路径，形成第二控制面印象。

## 逐包结论

| 包 | DSH/Cordis 是否直接加载 | 独立入口/第二权威 | 原生接缝与生命周期 | 安装/卸载形态 | 处理结论 |
|---|---|---|---|---|---|
| `dsh-evolve` | 是；Bundle row `evoforge-evolution` 加载 `name/inject/Config/apply` | 产品 bin 已删除；无独立 Runtime。Shadow driver 只在 `test/fixtures`，不 build/pack | hard `storageDomain`；可选 Agent、Commands、Jobs、Tools、Session persistence、message feedback；提供 `evoforge.evolution`/control service；watcher/supervisor 由 effect/fiber 释放 | `dsh plugin --profile web add/remove`；默认 enabled | 保留进化/Generation/审计算法；重构为 Bundle；删除产品 CLI |
| `dsh-evolve-web` | 是；Host row + 官方 `dsh.client` web module | 无 server、端口、数据库或状态机 | hard `evoforge.evolutionControl`；浏览器 RPC 只投影同一 Host 状态；client 注册随 DSH composition 卸载 | 与 `dsh-evolve` 一起安装；先移除 Web adapter 再移除 provider | 保留 client/UI adapter；删除重复 `dsh-evolve` patch row；禁止第二控制面 |
| `dsh-software-delivery` | 是；Bundle row `evoforge-software-delivery` | `dsh-delivery` bin 已删除；内部 verifier 不是用户入口 | hard Skill；原生 Goal/Tools；Tool 在 Host 注册并由 Agent preset 继承，执行时解析该 Agent 的 Bash/`update_goal`；注册随 fiber 释放 | 官方 add/remove；默认 enabled | 保留 Skill、Tool、Git verifier；重构 Agent-scoped Tool 解析；删除 CLI |
| `dsh-doctor` | 是；Bundle row `evoforge-doctor` | 无独立入口、存储或修复器 | Commands + Loader；只读 entries 快照，注册随 fiber 释放 | 官方 add/remove；默认 enabled | 保留只读 `/doctor`；补 Config/Bundle export |
| `dsh-telegram` | 是；Bundle row `evoforge-telegram` | 无 webhook server/daemon/第二 Session；外部已发送消息不是本地权威 | Agent、Commands、Session、Storage Domain、可选 Approval；长轮询、AbortController、delivery journal registration 全由 effect/fiber 持有 | 官方 add/remove；默认 disabled，profile patch 显式授权 exact agent/chat/user/token env | 保留薄 adapter；补 patch export；不扩展为 gateway |
| `dsh-goal-continuity` | 是；Bundle row `evoforge-goal-continuity` | 无进程管理、任务库、Mission 或扫描 daemon | native `agent/session-start` + `goals`; 只对 exact allowlist resume，Goal/round 持久化仍属 DSH | 官方 add/remove；默认 disabled | 保留极窄 policy；补 patch export；冻结后续 LC 功能 |
| `dsh-github-review` | 是；Bundle row `evoforge-github-review` | 无 webhook server、第二 Delivery 状态机或 merge 权限 | Agent、Storage Domain 与可选 Tool watch；poll task、monitor 和 AbortController 由 Cordis lifecycle 持有 | 官方 add/remove；默认 disabled，exact repo/agent/reviewer 配置 | 保留 exact-head follow-up；补统一 patch export/peer 门禁 |
| `dsh-evolve-telegram` | 是；Bundle row `evoforge-evolve-telegram` | 无通用 notifier、route 配置、timer 或审批 bot | 只组合现有 evolution control 与 Telegram route；事件和 effect dispose 释放 bridge | 官方 add/remove；默认 disabled | 保留窄 attention bridge；补 Config/patch export 门禁，后续迁移到 Channel Router |
| `dsh-resident` | 是；Bundle row `evoforge-resident`，注册 `/resident` | 无 executable、Runtime、daemon 或进程状态库；OS manager/unit 是唯一进程权威 | Commands；plan hash/service id 逐次确认，内部 launchd/systemd adapter 不进入模型表面 | 官方 add/remove；默认 disabled，exact profile/path 配置 | 保留 unit 算法；删除产品 CLI；测试 driver 仅在 `test/fixtures` |

## Root packaging 与文档

Root 是 private pnpm workspace，只负责构建、测试与打包，不导出 Runtime、installer 或产品 executable。所有 package 都导出自己的 `cordis.patch.yml`，声明一个官方 Bundle layer，不再依赖自定义 manifest。DSH/Cordis 只作为 peers + dev dependencies；普通 dependencies 只包含插件自有运行库。

README、中文 getting-started、status、roadmap、 operational Skills 与包 README 已统一为“安装进 DSH”。历史 evidence/ADR 可描述当时的测试，但必须显式标记由 ADR-0041 supersede，不能再作为用户运行手册。`check:docs` 会拒绝 operational 文档中的已删除 CLI 调用，也会拒绝没有 ADR-0041 标记的历史调用。

## Feature test

- 对需要软件交付并希望由客观 Git/check evidence 完成原生 Goal 的 DSH 用户，`dsh-software-delivery` 在现有 Agent/Goal/Tool/Approval 生命周期中提供可审查交付结果。
- 对需要解释当前插件组合是否 ready 的 DSH 用户，`dsh-doctor` 在原生会话中给出只读、可行动的 Loader 诊断。
- 对需要受控进化审查的 DSH 用户，`dsh-evolve`/Web adapter 复用 DSH Storage、Session 与 Host 权威，而不改变现有 Session 的模型表面。
- Telegram 与 Goal continuity 在 DSH 正常工作时仍提供独立、可选价值，不是 DSH bug workaround。

## Assembled 证据覆盖

现有 `test/clean-profile-suite.e2e.test.ts` 从六个核心 tarball 开始，使用官方 `dsh plugin --profile web add`，核对 manifest/Bundle/dump，启动真实 DSH Web Host，再用 shipped `standard` agent preset 创建真实 Agent/Session/Goal。零网络 DSH LLM adapter 让 Agent driver 调用 packed `complete_delivery`，实际 DSH Bash 运行 check、原生 `update_goal` 完成 Goal并写入 Session。随后 dispose、官方 remove、再次 dump/boot，确认 Tool/Skill/service 消失且原生持久化仍读到 complete Goal event。Resident、GitHub Review 与 Evolution Telegram 另有各自 packed lifecycle；九包同一次 gate 仍是 v0.1 未完成项。

该门禁同时检查 tarball 无 bin、无 `node_modules`、production dependencies 无 DSH/Cordis；CLI 启动使用随机端口并在 SIGTERM 后验证进程不存在。六包各自的 package lifecycle test 继续覆盖 watcher/长轮询/注册项卸载。
