# P0A.6：`dispose-owned-watcher` 产品 fixture 证据

> 状态：`implemented`；三个产品 fixture 中完成第二个，不等于 P0A 已退出

## 用户问题

长期运行的 DSH 插件若在 `apply` 中直接创建 timer、watcher、子进程或连接，热重载和配置禁用不会自动清理这些资源。结果通常不是立即崩溃，而是重复回调、文件句柄增长、重复外部动作和“重启几次后才出现”的隐蔽故障。

本 fixture 验证最小生命周期规则：资源在 `ctx.effect()` 内取得，cleanup 与插件 fiber 同生共死；Loader restart、disable、re-enable 和 root dispose 都有可观察的精确结果。

## 固定输入与受信边界

- DSH revision：`47f943859bef60e4160492346772ded9b24f765a`
- Case Pack：[`examples/case-packs/dispose-owned-watcher`](../../examples/case-packs/dispose-owned-watcher)
- 受管 Skill：[`skills/build-dsh-plugin`](../../skills/build-dsh-plugin)
- Trial：known-bad、known-correction、baseline、Candidate 四个独立 macOS Seatbelt workspace
- 外部 proposer：测试内固定 HTTP 响应，只补充生命周期 probe 检查点

Evaluator 与 `cache-safe-status` 一样，不执行模型任意生成的插件代码。它根据 Skill 是否要求在 `ctx.effect()` 内取得资源并返回 cleanup，选择两份固定 TypeScript fixture：正确实现或故意泄漏实现。

## 真实执行路径

每棵 Skill 树都执行：

```text
TypeScript strict noEmit
→ 真实 Cordis Loader boot
→ 启动真实 fs.watch + interval
→ 写文件并观察 watcher event + timer tick
→ entry.fiber.restart()
→ entry disabled=true
→ entry disabled=false
→ root fiber dispose
→ native-only DSH boot
```

正确实现的活动资源计数为：

```text
initial  restart  disabled  re-enabled  root-disposed
  1         1         0          1             0
```

known-bad 没有把资源交给 Fiber，计数会累积为：

```text
initial  restart  disabled  re-enabled  root-disposed
  1         2         2          3             3
```

Evaluator 在退出前有自己的受信清理兜底，防止故意泄漏样本拖住 Trial；该兜底不计作插件通过。

## 结果

2026-08-16 本机验证：

- known-bad=`fail`，known-correction=`pass`；
- active Skill 已含正确 ownership 规则，baseline=`pass`；
- Candidate 仅补充 probe 断言，Candidate=`pass` 但没有净改善；
- Decision=`review`，没有制造虚假晋升；
- 两个真实资源均产生过事件；restart 不重复，disable 与 root dispose 后均为零；
- 四个阶段的模型装配与 native-only DSH 逐字节相同；
- fixture 正常模型调用为 `0`，active Skill 不变。

## 尚不能声称

- 后续 `profile-install-remove` 已完成并记录于 [P0A.7](p0a-7-profile-install-remove.zh.md)；
- 未覆盖子进程、网络连接、临时目录和异常 cleanup，它们应在出现真实产品需求时各自增加 case；
- public final-test 不是用户本机未见 case；
- Candidate 仍是 Skill 数据，尚未开放任意生成代码执行；
- 没有证明崩溃恢复、Generation 回滚或长时稳定性。

下一份产品证据见 [P0A.7](p0a-7-profile-install-remove.zh.md)；最终本地未见首测见 [P0A.8](p0a-8-private-heldout.zh.md)。
