# V4.45 现有 Skill 发布门的最终 tarball 浏览器生命周期

日期：2026-08-21
状态：`verified`（最终 tarball 的 approve → inactive Generation → Host 冷恢复 → future-Session promote → reload → 断连恢复 → 官方卸载已验证；真实 provider、existing-Skill failed-Outcome Canary 与长期效果仍未完成）

## 本增量回答的问题

V4.44 已把唯一 `ExistingSkillRelease` Host owner 接入 Control、固定 Typert Remote 和 DSH Web，但当时只完成自动化组件验证。V4.45 从最终发布 tarball 和全新 DSH profile 出发，验证浏览器动作确实经过生产 Host/Storage/Generation owner，并且批准和晋升仍是两个可恢复、不会改变当前 Session 的独立 authority transition。

## 固定对象

- DSH revision：`47f943859bef60e4160492346772ded9b24f765a`。
- `dsh-evolve-0.1.0-alpha.1.tgz`：`sha256:2e6b3fc956085a27238e5ad6c72520d0a92b93f46ef98d3f58d36874121bd9bb`。
- `dsh-evolve-web-0.1.0-alpha.1.tgz`：`sha256:aaf6db16f81e6aacccbf0165e93fdf1e7503c93ea75ef2b490801399ccbaf727`。
- 浏览器 fixture 保持 test-only，未进入两个 tarball。它只在 Host 启动前准备一条内容寻址 Candidate 及完整 Admission/Holdout/Retention durable lineage，不调用 approve、reject 或 promote；所有 mutation 均由最终 Web → Typert Remote → Control → `ExistingSkillRelease` 完成。

## 精确证据链

- Candidate：`70e0b763a7c8f33845317a0daf3ff66f1dc02faf0e52262bb94047f1b1db47cf`。
- Admission：`6325a84869a2ae373acfa04420e0ffb531d21f2b928f47fca4b92188c2ba93bd`。
- Holdout：`1d494a56de4728005686a5c281eba0a422e4b935ddd4cceeba5874699f0dfbb9`。
- Retention：`960a6e9a9172463a93a9ae8c8c7166cff4d3c43e073783808e0b66939c2e9cb1`。
- Baseline/Candidate tree：`5e648f0885b1a69a427ef1deec6a4c47dfd04a33817c000260c628d52b5beb59` → `019ddb249ebc9c28a2738a21a881d3e1ac1a8564ddbfbff4d4110f16ff439dfa`。
- Candidate 修改 `SKILL.md`、增加 `references/release.md`，同时逐字节保留一个二进制资源；Web 显示修改、新增、保留文件和三段评测 identity。
- approve 后发布的 inactive Generation：`2ba72bd8…`。Host 冷重启后仍恢复同一 Generation 和人工决定；promote 后页面显示“已供未来 Session 使用”。

## 最终包与真实浏览器结果

1. DSH 官方 `plugin --profile web add` 从两个 tarball 安装；`--dump-config` 同时显示 Typert Loader、`dsh-evolve`、`dsh-evolve-web` 与 test-only overlay，Host 在 `127.0.0.1:43745` 启动。
2. Skills 视图把 exact release 投影为 `eligible`，Admission/Holdout/Retention policy warning 均为 0；人工填写备注并二次确认后，只产生 inactive Generation，页面明确声明当前和未来 Session 均未改变。
3. 在 promote 前停止 Host。浏览器“刷新”显示 `evoforgeEvolution/overview failed: Failed to fetch`，同时保留最后成功的 Candidate、证据和 inactive Generation 快照，没有把断线伪装为成功或清空证据。
4. 同一 profile/端口重启后再次刷新，错误清除，仍恢复同一 `2ba72bd8…` inactive Generation。再经独立确认执行 promote，页面明确声明只供未来 Session 使用、当前 Session 固定。
5. 整页 reload 后概览为 1 个进化 Skill 正在使用、0 项待确认；Skills 视图仍显示同一 Generation 已供未来 Session 使用。浏览器 console error 数为 0。
6. DSH 官方 `plugin --profile web remove dsh-evolve-web dsh-evolve` 后，profile 只剩官方 base/web bundles，两个 node_modules 入口均不存在，默认 dump 不含 `dsh-evolve`/`evoforge`；不带 overlay 的原生 DSH Web 可再次启动。

首次诊断还验证了 Admission 的真实路径门禁：macOS `/tmp` 别名会被 `realpath()` 识别为 `/private/tmp` 并以 warning/blocked 拒绝。最终通过规范真实路径运行，没有放宽生产防符号链接校验。

## 自动化门禁

- `package-contract.test.ts` 固定 fixture 不进入 tarball、必须准备 exact Candidate vault/Storage/Admission lineage、启动可接受首次 `eligible` 或重启后的 `approved`，并禁止 fixture 调用 approve/promote。
- `dsh-evolve-web` 局部 typecheck、21 项测试与 build 通过。
- 全仓最终 `pnpm check` 以退出码 0 通过文档、11 包 typecheck、499 passed / 3 skipped 与全部 build。

## 尚未证明

- fixture 的 `fail/pass` 是确定性 durable acceptance 数据，不是两套独立真实 provider 的效果结论。
- existing-Skill active Generation 的失败 Outcome 仍未触发同谱系 Counterfactual Canary/rollback；真实长期误晋升、负迁移、遗忘和误回滚率仍无数据。
- exact 飞书消息、真实 provider assembled 整链和同任务/模型/权限/预算 Hermes paired benchmark 仍阻止 tag 与完成声明。
