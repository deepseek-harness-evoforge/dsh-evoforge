# P0A.1 Owned-path tracer 证据

> 日期：2026-08-15
> 结论：`implemented`，尚未达到完整 P0A 的 `verified`

## 用户结果

`dsh-evolve shadow` 可以接收 owned Skill、版本化 case pack 和独立 run directory。若模型候选试图写出 owned Skill，系统在应用前给出 `reject`，保存证据，并证明 active Skill 的开始/结束 tree hash 一致。

## 当前验证

自动化测试穿过真实 CLI 进程、HTTP 模型边界、文件系统与报告文件，覆盖：

1. 越权候选以完整业务结论 `reject + exit 0` 结束；
2. 合法路径但尚无 Trial evaluator 的候选以 `incomplete + exit 2` 结束，绝不伪造建议；
3. 模型 HTTP 失败保存 incomplete 报告并返回 `2`；
4. output parent 经符号链接落入 active Skill 时，在任何写入和模型调用前返回 `1`；
5. active Skill 内容不变，越权文件不存在，成功路径只产生 `evidence/proposal.json` 与 `report.json`。

构建验证包括 TypeScript 类型检查、Vitest、tsdown 可执行 CLI 构建和发布包内容检查。

## DSH、缓存与权限

- 上游 epoch：`@deepseek-ai/dsh 0.1.0-rc.6`；P0A.1 尚不导入 DSH runtime package，因此没有虚构组装通过声明。
- 模型表面：正常 DSH Session 为 `none`；命令只在用户显式执行 Shadow 时调用模型。
- 正常 Session token/cache delta：`0`；没有 Provider、Tool、system prompt 或 catalog 变化。
- 外部效果：一条显式配置的模型请求，以及用户指定 run directory 中的证据文件。
- Protected Action：无 merge、发布、部署、秘密输出或不可逆外部写入。
- 卸载：删除包和 run directory 即可；DSH profile、Session、Goal 与 active Skill 没有私有状态依赖。

## 尚未通过的门

- 还没有隔离 Trial runner、known-correction、selection/final-test 或真实 DSH assembled fixture；
- 还不能对 in-scope Candidate 给出 `promote/review/reject`；
- 还没有证明优于 Hermes，也没有资格进入自动晋升、常驻进程或 Generation 发布底座。

下一纵切只能增加最小 Trial evaluator 与一对 known-bad/known-correction 校准；若 evaluator 不能在未见 case 上稳定判别，就停止扩展而不是增加平台复杂度。
