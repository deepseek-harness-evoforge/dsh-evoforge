# EvoForge DSH 插件接口与验收规范

> 上游核验基线：DeepSeek Harness `0.1.0-rc.5`，revision `47f943859bef60e4160492346772ded9b24f765a`

本规范约束 EvoForge 发布物，不发明第二套插件 API。运行时接口由 Cordis 和 DSH 所有；EvoForge 只规定一个 out-of-tree 插件必须如何选择接缝、保护缓存、验证生命周期并证明用户价值。

## 1. 进入条件

每个候选先回答：

1. 谁会主动安装它；完成后得到什么新结果？
2. 假设 DSH 完全符合文档，这个结果是否仍有价值？
3. 哪些原生 Service、事件、注册表和 profile 组合已经足够？
4. 它改变哪些模型可见内容、权限、持久状态和外部效果？
5. 用什么自动检查或真实 outcome 证明有效？
6. 卸载、崩溃和回滚后分别留下什么？

第二问为否时，将问题缩成上游复现，不创建插件。

## 2. 选择最小形态

| 需求 | 形态 |
|---|---|
| 只需要按需程序化指导 | Skill |
| 模型必须主动调用新的原子动作 | Tool Consumer |
| 观察事件、注册命令、提供 host 服务或组合现有能力 | Cordis runtime plugin |
| 用户安装后应自动向 profile 增加一组插件 | DSH bundle package |
| 只增加浏览器/TUI 呈现 | Client plugin 或现有 Host API 的 UI Adapter |

普通插件使用函数形态；只有真正需要被其他插件消费的具名服务才使用 `Service`。DSH loader 接受命名导出的 `apply(ctx, config)`，加载顺序由 `inject` 依赖而不是 YAML 行顺序决定：[首次插件](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-tutorial/01-first-plugin.zh.md#L5)、[Service 与 inject](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-tutorial/03-services.zh.md#L44)。

## 3. Runtime 契约

- 导出稳定诊断名 `name`。
- 硬依赖写入 `inject`；真正可选的能力在使用点通过 `ctx.get()` 探测。
- 可配置项同时导出 TypeScript `Config` 和运行时 Standard Schema；无效配置在加载或最早可解析点失败：[配置验证](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-tutorial/05-config.zh.md#L5)。
- 所有注册使用 DSH/Cordis 自带的 effect API。计时器、watcher、子进程、连接和临时目录等外部资源在 `ctx.effect()` 内获取并返回 disposer。
- 一个 disposer 内按顺序清理具有顺序依赖的资源；不要依赖多个异步 disposer 的完成顺序。
- 自有 Service 使用 `evoforge.*` 命名空间。Consumer 依赖 Service Definition，不导入具体 Provider 或 `agent-loop`。
- 新公共 seam 至少由两个真实 Adapter 证明；此前保持插件私有。

Cordis 会在插件卸载、热重载或依赖消失时撤销 effect 并重载 Consumer，因此“启动成功”不能代替卸载测试：[生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-tutorial/02-lifecycle-and-effects.zh.md#L5)。

## 4. 安装与组合契约

外部插件通过 profile 的 pnpm 环境安装。只有需要自动加入 profile layer 的包才在 `package.json` 声明：

```json
{
  "type": "module",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

Bundle 必须导出并发布 `cordis.patch.yml`；普通库或需要用户手工 patch 的插件不冒充 Bundle。DSH 会将声明 `dsh.bundle` 的已安装依赖加入 `dsh.profile.bundles`：[插件管理](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/apps/cli/reference/README.md#L41)。

在 DSH 仍为 RC 时，发布包对实际导入的 `@deepseek-ai/dsh-*` 与 `@deepseek-ai/cordis` 使用经过 CI 验证的精确兼容范围。每次扩大范围前，在该版本安装、dump composition、boot、dispose 并运行关键行为测试。

## 5. Cache Contract

先对插件归类，再决定测试：

| 模型表面 | 典型能力 | 默认要求 |
|---|---|---|
| 无 | Storage、observer、host command、UI projection | 正常请求 composition 不变 |
| 按需 Skill body | 程序化指导 | catalog 稳定；正文只在原生 Skill 加载时出现 |
| Tool | 新模型动作 | name、description、Schema、顺序在 Session 内固定 |
| System prompt | 全局行为 | 必须证明其他形态不足，并测完整前缀影响 |

所有插件共同满足：

- 同一 Session 内模型可见前缀、工具集合、Schema、顺序和 Skill catalog 不变化。
- 动态时间、进度、审批、Candidate 和 UI 状态保留在 host plane，或通过已有稳定工具按需读取。
- 无变化 Hook 是真正 no-op。
- 新模型可见输入必须可从 Session 事实重建；不能存在“模型看见但日志不知道”的状态。
- Cache gate 比较完整 composition fingerprint 和真实 cache-read，不接受插件局部估算。

## 6. 权限与外部效果

- 默认授权仅限 worktree、编辑、仓库检查、commit 和 Draft PR。
- merge、release、生产部署、秘密、付费、权限扩大及不可逆动作继续使用 DSH Approval/Permission/Sandbox 或明确部署策略。
- Markdown/Skill Candidate 按语义效果检查；文件不是可执行代码不代表低风险。
- 每个外部写入使用稳定 idempotency key，并在重试前查询既有结果；版本回滚不宣称撤销已发生的现实效果。
- 收集 Session/Goal/feedback 时默认最小引用、本机保存、项目隔离；对外发给模型或 PR 前脱敏，
  或由用户针对明确内容、目标 provider 和单次动作显式授权原文。
- 从引用复制用户原文必须同时有配置级本地目录授权和逐条显式动作；私有目录/文件权限、内容上限、
  当前 source version 与最小归因都必须 fail closed。未评分草稿不能宣称为 Case 证据。
- 把私有原文交给外部模型必须由另一次显式动作授权，清楚说明 provider、付费可能性和内容范围；
  原文不默认作为输入字段复制到报告、journal 或长期 evidence，并告知 proposer 回显可能随 Candidate
  持久化。提议模型不得同时定义晋升 evaluator。

## 7. Persistence 与交互

- DSH Session、Goal 和原始事件始终是事实源；插件状态只保存派生索引、引用和自己的状态机。
- durable write 先于内存权威状态变化；恢复器依据持久状态重排未完成工作。
- command/view/client 读取同一 host-side projection。界面动作返回明确的 accepted、rejected、pending 或 failed，不通过 Prompt 猜测状态。
- 等待 review 不阻塞原 Session；无回复不影响 DSH 其他能力。

## 8. 最小测试矩阵

| 表面 | 必须证明 |
|---|---|
| Config | 默认值、非法值、缺失引用和版本不兼容会明确失败 |
| Lifecycle | load、dependency loss、reload、dispose 后无残留注册、timer、watcher、进程或临时目录 |
| Composition | bundle 安装/卸载、`--dump-config`、重复加载和插件顺序无隐式依赖 |
| Behavior | 单元测试加一条真实组合路径；用户/模型可见行为使用 keyless snapshot 或等价 assembled test |
| Cache | 同 Session composition 稳定；声明 no-surface 的插件前后 fingerprint 相同 |
| Permission | Protected Action 无法被默认配置或 Candidate 激活 |
| Persistence | 每个 durable transition 前后注入崩溃，无半状态和重复外部效果 |
| Removal | 删除 Bundle 或禁用插件后，原生 DSH 仍能启动并恢复自己的 Session/Goal |

工具插件还必须通过真实 `ctx.tools.execute()` 流水线，而不是只直接调用 `execute`；注册和结果事件模式见[进入 Harness](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-tutorial/07-into-the-harness.zh.md#L19)。

## 9. 发布证据

一个插件进入 Draft PR 前附带一页以内的证据：用户结果、DSH seam、model surface、权限差异、持久状态、测试命令与结果、cache delta、卸载结果、支持的 DSH 版本和未解决限制。字段没有变化时写 `none`，不复制一套冗长合规模板。
