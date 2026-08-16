# P1.11 Exact Candidate Retention Gate 实现证据

> 声明等级：`implemented`。本页证明一个 exact Shadow Candidate 可被另一个可信 Case Pack 检查
> 是否遗忘旧能力；不声明完整抗遗忘、自动发布门、真实 provider 效果或生产长期可靠性。

## 用户痛点

一次 Shadow 只能说明 Candidate 改善了当前 Case Pack。真实 Skill 演进常见的失败是：加入一条新规则
时删掉或冲淡旧规则。继续生成更多 Candidate、把经验塞进 Prompt，或建设历史 Case 平台，都不能直接
证明旧能力仍成立。

P1.11 增加一个最小 host CLI：

```text
dsh-evolve retain --run <completed-shadow-run> \
  --case-pack <trusted-prior-case-pack> --output <new-retention-run>
```

## Exact gates

- source run 必须 terminal complete，且 report exact 位于该 run；
- run id、Skill 名、baseline hash、primary Case Pack hash、durable proposal/hash 与 report 必须一致；
- source 建议必须为可审查的 `promote|review`，reject/incomplete 不能进入；
- prior Case Pack 必须与 primary Pack 路径和内容 hash 都不同，并提供 calibration + Trial；
- baseline、primary Pack、prior Pack 与 output 相互分离；Trial 前后输入 hash 不变；
- Trial 重建出的 Candidate tree hash 必须等于 source report 的 exact Candidate；
- baseline 必须先通过 prior Pack，Candidate fail 才能归因成 `regressed`。

## 前向测试

macOS 测试先用一个公开 browser Case Pack 产生两种 Candidate：

1. **回归 Candidate**：增加真实浏览器 E2E 指令，但删除原来的 owned-path 指令。它在 primary
   Shadow 获得 `promote` 建议；Retention 中 prior baseline pass、exact Candidate fail，返回
   `regressed`，CLI 退出 `3`。
2. **保留 Candidate**：保留 owned-path 指令并追加浏览器指令。它通过同一 primary Shadow；Retention
   中 baseline/Candidate 都 pass，返回 `retained`，CLI 退出 `0`。

两次 primary Shadow 共调用 proposer 两次；四次 Retention（direct + packed CLI 语义）之后调用数仍为
两次，因此每次 Retention proposer calls 固定为 `0`。active Skill 在全部运行后逐字节不变。

独立篡改测试分别让 durable proposal 与 proposal hash 不一致、让 hash 一致的 proposal 尝试路径逃逸；
两者都在创建 output 和启动 Trial 之前 fail closed，逃逸目标没有被创建。崩溃测试在第一个 sealed
evaluator 已启动后向 CLI 发送 `SIGKILL`，等待超过
evaluator 延迟后仍只有一个 `.trial-*`，没有 `retention-report.json`、没有第二次 Trial、active Skill
不变；恢复必须由操作者选择新 output 重新显式调用。

## Package 与 CI 边界

- `pnpm pack` 生成真实 tarball；真实 DSH profile add 后直接执行已安装的 `dist/cli.mjs retain`，确认
  packed artifact 含新命令及其独立 usage contract；随后 boot/dispose/remove，native composition 不变；
- macOS CI 显式运行 retention forward/crash test；Linux/Node 22/24 执行 source-integrity test，sealed
  forward lane 按平台明确 skip；
- PA-1 包含 Retention，防止未来把它改成隐式 proposer、自动 release 或崩溃后自动重试的通道。

关键自动化文件：

- `packages/dsh-evolve/test/retention-gate.e2e.test.ts`
- `packages/dsh-evolve/test/package-install-remove-generation.e2e.test.ts`
- `.github/workflows/ci.yml`

本次本地复现结果：`dsh-evolve` 单 worker 全量为 148 passed / 2 skipped；Retention、原有
Evaluator `SIGKILL` 与 packed profile 三个文件为 5/5；PA-1 为 Evolve 37/37、Software Delivery
22 passed / 1 skipped、Web 8/8、Telegram 22/22。全仓按包顺序复跑为 Doctor 5/5、Evolve
148 passed / 2 skipped、Software Delivery 26 passed / 1 skipped、Telegram 37/37、Web 9/9，全部
构建与文档链接检查通过。

## KV Cache 与成本

- normal Session 新增 Tool/Prompt/Skill/system message：`0`；token 增量：`0`；
- Retention proposer request：固定 `0`；
- 完整 Retention：known-bad、known-correction、baseline、Candidate，共四次 sealed evaluator；
- assembled evaluator 内部如有模型调用，comparison 的 `modelCalls/usage` 会进入报告；这是独立 Trial
  成本，不得被“零 proposer”掩盖；
- 没有轮询、通知中心、Mission、Memory、Case registry、suite optimizer 或第二个 daemon。

## 仍未证明

- 一个 prior Pack 不能代表全部历史能力，也没有证明 Case Pack 不会过期或相互冲突；
- 未收集真实 provider Candidate 的遗忘率、Retention 误阻塞率、单位保留成本或真实任务净收益；
- Retention report 尚未绑定 review/promotion，因此它是显式离线证据，不是自动发布门；
- 只有 macOS sealed backend；Linux/Windows、磁盘 quota、多日 soak 与陌生用户可用性仍待验证；
- 不能据此声称“完美自进化”、完整抗灾难性遗忘或已经上位替代 Hermes。

设计契约见 [P1.11](../architecture/p1-11-exact-retention-gate.zh.md)，决策见
[ADR-0031](../adr/0031-retention-is-an-exact-zero-proposer-gate-before-a-case-platform.md)。
