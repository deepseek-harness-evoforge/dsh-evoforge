# 开始参与 dsh-evoforge

## 1. 环境

- Node.js `^22.19.0 || >=24`
- pnpm `11.7.0`
- Git

克隆后运行：

```bash
pnpm install
pnpm check
```

`pnpm check` 依次执行 TypeScript 类型检查、全部测试和构建。生成目录 `dist/`、依赖目录和 `.evoforge/` 本地证据不会进入 Git。

## 2. 当前包

```text
packages/dsh-evolve/
  src/          Shadow CLI 实现
  test/         跨 CLI 进程的行为测试
  README.md     包级行为和限制
```

构建和检查单包：

```bash
pnpm --filter dsh-evolve typecheck
pnpm --filter dsh-evolve test
pnpm --filter dsh-evolve build
pnpm --filter dsh-evolve pack --pack-destination "$PWD/.evoforge/pack"
```

### P0B runtime 开发装配

`dsh-evolve` 目前是普通 Cordis runtime plugin，不是自动修改 profile 的 Bundle。
在 DSH Storage Domain 已装配的配置里添加：

```yaml
- id: dsh-evolve
  name: /absolute/path/to/dsh-evoforge/packages/dsh-evolve/dist/index.mjs
  config:
    cacheRoot: /absolute/path/to/.dsh/evoforge/git-skills
    sources:
      - name: build-dsh-plugin
        repository: /absolute/path/to/owned-repository
        path: skills/build-dsh-plugin
    supervisor:
      runRoots:
        - /absolute/path/to/.dsh/evoforge/runs
      scanIntervalMs: 30000
```

每个 Generation artifact 的 `name` 都必须有一条 source。Repository 必须能解析
manifest 中的完整 commit 和 tree object id；晋升前会物化并逐 blob 验证普通
non-executable 文件。`cacheRoot` 只是带 owner marker 的只读重建缓存，Git 才是事实源。

装配原生 `@deepseek-ai/dsh-commands` 后，普通用户可以使用：

```text
/evolve status
/evolve promote <64-char-generation-id>
/evolve rollback
```

命令不调用模型，且只改变 future Session。尚无 Candidate review inbox；测试或后续
host consumer 仍可通过 `ctx.get('evoforge.evolution')` 使用
`publishGeneration()` 与只读查询。不要把 P0C.1 command 当作已完成的自动晋升产品。

`supervisor` 可省略。启用时还要在同一 DSH composition 中装配原生
`@deepseek-ai/dsh-jobs-local`（或兼容 `ctx.jobs` 实现）。每个 `runRoots` 只扫描直接
子目录，不跟随符号链接；自动恢复仅接受已落盘 Candidate 的
`candidate-ready` / `trial-running`。`prepared` 不会自动调用模型，
`proposal-pending` 也不会自动重试。当前 Job 可从 DSH host plane 观察或取消，重启
事实仍来自 `run-state.json`，而不是易失的 Job record。
取消 Job 后，同一 DSH 进程不会再次自动提交该 run；下次 DSH 启动仍可从未终结
journal 继续。P0C 会再提供显式、可持久化的 pause/resume 控制。

## 3. Shadow 输入

命令：

```text
dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir>
```

若同一个 output run 被进程中断，保持 Skill、Case Pack、模型 route 不变并显式恢复：

```bash
dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir> --resume
```

若中断发生在付费 proposal 已发出但 response 尚未 durable 的窗口，恢复返回
`2 + incomplete/uncertain`，不会自动重试。若 Candidate 已 durable，则只重跑
无网络的 Sealed Trial。并发恢复会被 run owner lock 拒绝。

`skill-dir` 必须包含带 `name` frontmatter 的 `SKILL.md`。只有安全门的最小
Case Pack 可以不声明 Trial；要得到 in-scope Candidate 的完整建议，manifest
还必须声明 search evidence、隐藏 evaluator 和两个 calibration tree：

```json
{
  "schemaVersion": 1,
  "id": "real-browser-e2e",
  "epoch": {
    "dshRevision": "0.1.0-rc.6",
    "evaluatorVersion": "browser-e2e-guidance-v1"
  },
  "budget": {
    "candidateLimit": 1,
    "trialLimit": 4,
    "inputTokenLimit": 4000,
    "outputTokenLimit": 600
  },
  "search": {
    "evidence": "search/evidence.md"
  },
  "trial": {
    "evaluator": "final-test/evaluator.mjs",
    "timeoutMs": 5000,
    "outputLimitBytes": 65536
  },
  "calibration": {
    "knownBad": "calibration/known-bad",
    "knownCorrection": "calibration/known-correction"
  }
}
```

完整目录示例见
[`examples/case-packs/browser-e2e-guidance`](../examples/case-packs/browser-e2e-guidance)。
proposer 只会收到 active Skill 和 `search.evidence`；calibration tree 与
`trial.evaluator` 不进入模型请求。macOS 实现会分别复制 known-bad、
known-correction、baseline 和 Candidate，执行四次 Sealed Trial。Evaluator 必须是
一个只依赖 Node.js builtin 的 ESM 文件，并向 stdout 输出：

```json
{
  "schemaVersion": 1,
  "passed": true,
  "checks": [{ "name": "check-name", "passed": true }]
}
```

需要验证真实 DSH 组合时，Trial 可显式声明：

```json
{
  "trial": {
    "evaluator": "final-test/evaluator.mjs",
    "timeoutMs": 15000,
    "outputLimitBytes": 65536,
    "dshAssembled": true
  }
}
```

此时还必须设置 `DSH_EVOLVE_DSH_SOURCE_DIR`，指向已经安装依赖并完成
`build:lib:host` 的 DSH checkout。Host 会先确认它是 `@deepseek-ai/dsh-root`，再用
Git 检查实际 `HEAD` 与 `epoch.dshRevision` 完全相同。DSH tree 只读挂载；
workspace 仍是唯一可写区域。Evaluator 除普通 checks 外必须返回真实组合证据：

```json
{
  "schemaVersion": 1,
  "passed": true,
  "checks": [{ "name": "real-loader-agent-turn", "passed": true }],
  "composition": {
    "fingerprint": "64-char-sha256",
    "modelCalls": 2,
    "usage": { "inputTokens": 18, "outputTokens": 8, "cacheReadTokens": 2 }
  }
}
```

公开 assembled 示例见
[`examples/case-packs/browser-e2e-guidance-assembled`](../examples/case-packs/browser-e2e-guidance-assembled)。
它使用无密钥脚本 Adapter 跑真实 Loader、Agent Loop、Skill 注入和 bash Tool，
用于验证装配与 KV Cache 归因，不代表真实模型已经改善。

Case Pack 是可信本地输入，但 evaluator 仍运行在无网络、无父环境秘密、限制
读写范围、时间和输出的进程中。当前没有 workspace 磁盘配额。

Shadow 使用一个显式配置的 OpenAI-compatible proposer：

```bash
export DSH_EVOLVE_MODEL_BASE_URL=https://provider.example/v1
export DSH_EVOLVE_MODEL_NAME=model-name
export DSH_EVOLVE_MODEL_API_KEY=secret

node packages/dsh-evolve/dist/cli.mjs shadow ./skill \
  --case-pack ./case-pack \
  --output ./runs/run-001
```

仓库内示例路径可替换为：

```bash
node packages/dsh-evolve/dist/cli.mjs shadow \
  ./examples/skills/browser-e2e-baseline \
  --case-pack ./examples/case-packs/browser-e2e-guidance \
  --output ./runs/browser-e2e-demo
```

assembled 示例还需要：

```bash
export DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness

node packages/dsh-evolve/dist/cli.mjs shadow \
  ./examples/skills/browser-e2e-baseline \
  --case-pack ./examples/case-packs/browser-e2e-guidance-assembled \
  --output ./runs/browser-e2e-assembled
```

自动化测试使用本地固定 HTTP proposer 来验证框架行为；真实 provider 是否能提出
有效修正是另一项实验结论，不能由该固定响应替代。

这可能产生付费模型调用。不要把 API key 写进 manifest、命令历史、Issue、测试 fixture 或 Git；程序不会将环境变量中的 key 写入报告。

## 4. 退出语义

- `0`：一次完整业务结果；可能是 `promote`、`review` 或 `reject` 建议，但绝不自动激活；
- `1`：参数、目录、配置或兼容性错误，未开始有效 Trial；
- `2`：评测不完整；模型失败、预算超限、平台无 Sealed Trial、active Skill 或 Case Pack 被并发改变等均走这里。

`2` 不是失败掩盖，而是核心安全合同：证据不足时不猜测 `promote/review/reject`。

## 5. 开发下一纵切

在修改代码前阅读：

1. [CONTEXT.md](../CONTEXT.md)
2. [需求基线](requirements.zh.md)
3. [插件接口规范](plugin-contract.zh.md)
4. [P0A Shadow 契约](architecture/p0a-shadow-contract.zh.md)
5. [ADR-0006：Sealed Trial](adr/0006-fail-closed-sealed-trial-execution.md)
6. [CONTRIBUTING.md](../CONTRIBUTING.md)

新增行为先写穿过公共接缝的红测试。只有模型、外部 provider 或操作系统边界可以被替换；不要 mock evaluator 内部阶段后再声称端到端通过。
