# V5.12 Existing-Skill 低风险自动晋升证据

日期：2026-08-24
状态：`verified`（窄自动晋升、最终 tarball、真实 DSH Web 故障恢复和官方卸载已验证；真实 Provider 长期效果与 Hermes paired 仍未完成）

## 用户结果

部署者只按 native Workspace 显式授权后，DSH 可以把一个已经由内部纠正证据产生、并通过独立 paired Holdout 与 Retention 的明确低风险现有 Skill 指令改进自动用于未来 Session。用户不需要选择 Skill、Candidate、工作流或路径；当前 Session 不漂移。模糊、改写、增文件、受保护效果、成本/cache 回退、暂停和父版本漂移继续阻断或留给人工。

## 产品边界

- 对象仍是 `dsh-evolve` DSH Bundle 内部的 sole Host release owner，不是 Codex 插件、CLI、daemon 或第二 Runtime。
- `automaticPromotionPolicies` 每项只有 `id` 与 `workspaceId`；没有 Skill/source/path/target/Case Pack/evaluator。
- 不搜索、下载、获取或安装外部能力；只消费现有 DSH 内部经验形成的 existing-Skill Candidate。
- 只允许 exact baseline `SKILL.md` 末尾追加 1–2048 canonical UTF-8 bytes；其他整包文件、mode 和 bytes 必须全等。
- protected-effect lexical indicators 必须为空；代码、脚本、权限、凭据、消息、网络、付费、部署、新 Skill 和外部效果均不能自动发布。
- Admission、improved Holdout、independent retained Retention、assembled/calibration/composition/input integrity、zero proposer 与 active parent 全部重验。
- paired evidence 有模型调用时，Holdout 与 Retention 都要求 Candidate model calls、input/output/reasoning/cache-write 不增加且 cache-read 不下降；两侧受相同 sealed Case Pack timeout。
- 自动决策和 inactive Generation 先持久化，再选择未来 Session；崩溃、取消和重复 reconcile 幂等恢复。
- 原生 DSH Jobs 只负责唤醒/可见性，不保存第二份 durable queue；Candidate、评测、release decision 和 Generation pointer 是恢复事实。
- Control/Web 的 `scanAutomatic()` 是只读投影，不在页面刷新时触发 mutation 或模型调用。

## 自动化证据

已执行：

```text
pnpm --dir packages/dsh-evolve typecheck
pnpm --dir packages/dsh-evolve test -- existing-skill-release.test.ts evolution-control-plane.test.ts config-contract.test.ts
DSH_SOURCE_ROOT=<pinned-deepseek-harness-checkout> pnpm generate:typert
pnpm --dir packages/dsh-evolve-web typecheck
pnpm --dir packages/dsh-evolve-web test -- evolution-action.client.test.tsx
```

当前结果：

- `dsh-evolve` TypeScript host/test contracts 通过；
- `dsh-evolve` 305 passed、1 skipped；
- Web 26 passed；
- 根级 `pnpm check` 以退出码 0 完成文档、RP-1/AS-2 未授权合同、11 包 typecheck/test/build，共 564 passed、3 skipped；
- 十一包 clean-profile 最终 tarball add/dump/boot、原生 Session/Goal/Storage/Tool、dispose/remove/reboot/readback 1/1 通过（29.77 秒）；
- 固定 DSH revision `47f943859bef60e4160492346772ded9b24f765a` 的 Typert Host/Remote 生成物已更新；
- 覆盖 clear append-only 自动晋升、改写/受保护效果/usage regression 拒绝、durable pause 及检查后竞态重检、重复幂等、decision→pointer 崩溃恢复、原生 Jobs 唤醒、Control read-only projection 与 Web 可见原因；
- 真实 DSH Storage restart 同时重读旧 human decision 与新增 automatic decision。

## 最终 tarball 与真实 DSH Web

- `dsh-evolve-0.1.0-alpha.1.tgz`：`sha256:6b099cdc9f4b3a8720be8eca4631e783bce45bef67f0bf0745a881622b3bd595`。
- `dsh-evolve-web-0.1.0-alpha.1.tgz`：`sha256:cfc4aa00973c91ae50303fde3de3246de10649b367e6fe48b7fb2f992e95de34`。
- 两包经官方 `dsh plugin --profile web add` 安装进全新隔离 profile；组合 dump 只增加 test-only overlay，出货 Bundle 未修改。夹具只写 exact baseline、append-only Candidate、Admission/Holdout/Retention 密封证据，不写 release decision、Generation 或活动指针。
- 原生 Jobs 经生产 `ExistingSkillRelease` 自动持久化 decision、发布 inactive Generation 并选择未来 Session。真实浏览器唯一显示“已启用低风险指令自动晋升 · 1 个 Candidate 已检查 · 0 个告警”“已自动晋升 · 仅追加低风险指令且 Holdout/Retention 均通过”和 active Generation。
- 首次加载和整页 reload 后，上述两条均保持唯一、可见。Host 停机后人工刷新明确显示 `Failed to fetch`，同时保留最后可信自动晋升快照；同 profile/同端口冷恢复后 alert 清零，自动状态保持唯一，再次整页 reload 仍一致。
- 故障注入期间只有 6 条预期连接重试 warning，浏览器 console error 为 0。
- 官方 `remove dsh-evolve-web dsh-evolve` 后 profile dependencies 为空，两个 `node_modules` 入口消失，默认 dump 不含 `dsh-evolve|evoforge`。无 overlay 的原生 DSH Web 可在同端口启动，“演化”入口为 0，“设置”仍可见，console error 为 0。

## 尚未证明

- 两套独立真实 provider 下的 Candidate 质量、false promotion、token/cache 与长期 latency；
- 长期 transfer、negative transfer、遗忘、Canary/rollback 比率；
- 与固定 Hermes revision 的同模型、同任务、同权限、同预算 paired benchmark；
- v0.1 发布或 Hermes 上位替代完成。

因此本页只能证明窄自动晋升控制与恢复实现，不证明真实模型持续变强。
