# V4.50：exact 跨 Goal Skill 复用持久证据

> 日期：2026-08-21
> 固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`
> 结论：本纵切已验证；它只证明 exact Skill 调用跨 Goal 复用，不证明效果提升或整体自进化完成。

## 验证对象

`dsh-evolve` 现在从原生 DSH Session 事件读取成功且 source-linked 的 `skill` 调用，先执行官方 durability
checkpoint，再绑定 active 原生 Goal、调用时内容哈希与 Session-pinned Generation，写入有界
`evoforge_skill_uses` StorageDomain。冷启动在 Agent pre-step 从已持久化 Session 幂等补记。

Host 只在同一 Workspace、相同 Skill name、相同模型可见内容 SHA-256 和相同 Generation 覆盖至少两个不同
Goal id 时投影 `cross-goal-observed`。同 Goal retry、失败调用、同名不同内容、不同 Generation 和无 Goal 事件均
不会组成跨 Goal 复用。Command、固定 Typert Remote 与 DSH Web 共用这一个 Host 权威 summary。

## 自动化结果

- `dsh-evolve`：66 files passed、1 skipped；287 tests passed、1 skipped。新增测试覆盖 live checkpoint、冷启动
  replay、失败 abstain、真实 JSON StorageDomain、exact content/Generation 分桶、同 Goal 去重、重放幂等、
  identity drift 拒绝和 restart persistence。
- `dsh-evolve-web`：2 files、23 tests passed。新增测试覆盖 Workspace/current/parent rollup、bounded exact 行、
  中英文提示，以及浏览器 fixture 必须调用真实原生 Skill Tool、不得直写 use store。
- 根级 `pnpm check`：通过；11 个包累计 533 tests passed、3 skipped，文档、全部类型检查、测试、构建和
  生成 Typert freshness 共同通过。

## 最终包与真实浏览器

从最终构建产物生成并用 DSH 官方 `plugin --profile web add` 安装到全新隔离 profile：

- `dsh-evolve-0.1.0-alpha.1.tgz`：SHA-256
  `5a2ee57fc2d2dd9d4417a8e4ef258bbb4e5c08dad26649288b7883460d53cfd4`
- `dsh-evolve-web-0.1.0-alpha.1.tgz`：SHA-256
  `c789fedfd4f89b01a42bba0cd808fc71fc1ed196bcf47fc5f77fbf75fb843301`

test-only fixture 在同一真实 Workspace 内创建两个原生 DSH Agent/Session 和两个不同 Goal，向各 Agent 的
原生 SkillRegistry 注册同一个 `reuse-dsh-evidence` Skill，通过 `ctx.tools.execute({ name: 'skill' })` 执行真实
Skill Tool，并把合法 Tool call/result 写入原生 Session 后 flush。fixture 不读取或写入
`evoforge_skill_uses`。

真实 DSH Web 的“高级”控制面首次启动、整页刷新与 Host 完全停止后同 profile/同端口冷启动均显示：

- Workspace：2 次使用、2 个 Goal、1 个 exact Skill 版本、1 个跨 Goal 复用版本；
- 当前选择：同样为 2/2/1/1；
- `reuse-dsh-evidence · 20e78780… · 原生 DSH`；
- `模型调用 2 · 用户调用 0 · 已观测跨 Goal 复用`；
- 明示“持久调用复用只是描述性事实；它不证明任务成功、能力提升、保持率或晋升资格”。

第一次冷启动复验曾发现 test-only fixture 把 `tool/result.message.role` 写成非 DSH 持久化合同的 `tool`，导致
Session history validation 失败。验收没有放过该问题：fixture 改为 DSH 当前合同的 `role: user` 与
`source.kind: tool`，重新从全新 profile 执行全过程。修正后两个 Session 正常恢复，无 history corruption。

最后使用官方 `plugin --profile web remove dsh-evolve-web dsh-evolve` 卸载；profile dependencies 为空、两个
node_modules 入口均消失、默认 dump 不含 `dsh-evolve|evoforge`。不带 test overlay 的原生 DSH Web 再启动后
“演化”按钮计数为 0，新浏览器页 console error 为 0。故障注入期间的 connection retry warn 是预期可恢复日志，
不是最终页面 error。

## 不足与禁止外推

- 两次调用来自确定性的 test-owned Skill/Goal，经真实 DSH Tool/Session/Storage 路径执行，但不是两个真实用户
  长期任务，也没有真实 provider 模型调用。
- 本门没有证明路由正确、任务成功、复用带来收益、返工下降、负迁移、遗忘、Retention 或自动晋升；所有投影
  固定无因果、无发布权。
- 真实飞书 exact route、两套独立真实 provider、长期 Outcome 和 Hermes 同条件 paired benchmark 仍未完成。
- 因此不创建 tag，不宣称 v0.1 或 Hermes 上位替代完成。
