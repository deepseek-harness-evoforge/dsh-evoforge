# P0A.5：`cache-safe-status` 产品 fixture 证据

> 状态：`implemented`；三个产品 fixture 中完成第一个，不等于 P0A 已退出

## 用户问题

Goal 阶段、审批数、Candidate 状态和时间戳会频繁变化。若状态插件把这些值注册成动态 system prompt、Tool 或 Skill，普通会话即使没有使用进化能力也会改变模型输入前缀，降低 KV Cache 命中率并增加 token 成本。

本 fixture 验证一个更小的扩展边界：状态是宿主面的权威投影；插件更新状态时，模型装配不变；插件移除后，DSH 恢复原生装配。

## 固定输入与受信边界

- DSH revision：`47f943859bef60e4160492346772ded9b24f765a`
- Case Pack：[`examples/case-packs/cache-safe-status`](../../examples/case-packs/cache-safe-status)
- 受管 Skill：[`skills/build-dsh-plugin`](../../skills/build-dsh-plugin)
- Trial：known-bad、known-correction、baseline、Candidate 四个独立 macOS Seatbelt workspace
- 外部 proposer：测试内固定 HTTP 响应，只给现有 Skill 补充一条 Client UI 指引

Evaluator 不执行模型任意生成的插件代码。它只根据受管 Skill 是否明确要求“默认零模型表面”和“动态状态留在 host plane”，选择两份仓库内固定、可审计的 TypeScript fixture 源码：

- known-bad 注册动态 `systemPrompt.context`；
- 正确实现注册 Cordis host `Service`，不声明 Provider、Tool、Skill、catalog entry 或 prompt section。

这条限制使当前证据只能证明 evaluator 方向和真实装配接缝，不能证明任意代码 Candidate 已可安全执行。

## 真实执行路径

每个 Trial 都完成：

```text
固定 TypeScript 插件源码
→ pinned DSH TypeScript strict noEmit
→ 真实 Cordis Loader boot
→ 读取并更新 host status service
→ 前后两次真实 systemPrompt.assemble()
→ dispose root fiber
→ 用 native-only 配置重新 boot
```

检查项：

1. 插件通过 TypeScript parse/typecheck；
2. 真实 Loader 可启动；
3. host service 能保存并返回最新状态；
4. 状态更新前后模型装配逐字节一致；
5. 模型装配不出现 Goal、审批或 Candidate 状态；
6. dispose 后 host service 不再可取；
7. 移除插件后的装配与 DSH 原生装配一致；
8. baseline/Candidate 非目标 composition fingerprint 相同。

## 结果

2026-08-16 本机验证：

- known-bad=`fail`，known-correction=`pass`；
- 当前 active Skill 已包含正确 cache 规则，因此 baseline=`pass`；
- Candidate 只补充 UI 消费方式，Candidate=`pass`，但没有胜过 baseline；
- Decision=`review`，理由为 `candidate did not improve the passing baseline`；
- 每棵树的 fixture 模型调用数为 `0`、usage=`{}`；
- active Skill 未被修改；
- macOS 三组回归共 6 个测试通过。

`0` 次模型调用描述的是 fixture 插件的正常运行面，不包括显式执行 Shadow 时的一次 proposer 调用。测试内 proposer 的固定计量是 input `920`、output `92`；它不代表真实 provider 价格。

## 这份证据防止了什么

- 防止“加个状态 Tool 让 Agent 随时查询”的无条件模型表面膨胀；
- 防止把高频状态塞入动态 system prompt；
- 防止将“Candidate 也通过”误判为“Candidate 有净改进”；
- 防止插件卸载后仍把私有状态留在 DSH 装配中。

## 尚不能声称

- 后续两个产品 fixture 已完成，分别记录于 [P0A.6](p0a-6-dispose-owned-watcher.zh.md)与 [P0A.7](p0a-7-profile-install-remove.zh.md)；
- public final-test 已参与开发，仍缺用户本机未见 case；
- 尚未执行任意 Candidate 代码，也没有真实 provider paired benchmark；
- 没有 Generation、激活、回滚、常驻恢复或异步 review inbox；
- 因此不能声称已实现持续进化或已经优于 Hermes。

后续产品证据见 [P0A.6](p0a-6-dispose-owned-watcher.zh.md)与 [P0A.7](p0a-7-profile-install-remove.zh.md)。当前下一步是本地未见 final-test。
