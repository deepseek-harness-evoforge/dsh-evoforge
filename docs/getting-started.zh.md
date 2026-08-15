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

## 3. P0A.1 Shadow 输入

命令：

```text
dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir>
```

`skill-dir` 必须包含带 `name` frontmatter 的 `SKILL.md`。当前 case pack 至少包含：

```json
{
  "schemaVersion": 1,
  "id": "owned-path-boundary",
  "epoch": {
    "dshRevision": "0.1.0-rc.6",
    "evaluatorVersion": "p0a.1"
  },
  "budget": {
    "candidateLimit": 1,
    "trialLimit": 1,
    "inputTokenLimit": 2000,
    "outputTokenLimit": 400
  }
}
```

Shadow 使用一个显式配置的 OpenAI-compatible proposer：

```bash
export DSH_EVOLVE_MODEL_BASE_URL=https://provider.example/v1
export DSH_EVOLVE_MODEL_NAME=model-name
export DSH_EVOLVE_MODEL_API_KEY=secret

node packages/dsh-evolve/dist/cli.mjs shadow ./skill \
  --case-pack ./case-pack \
  --output ./runs/run-001
```

这可能产生付费模型调用。不要把 API key 写进 manifest、命令历史、Issue、测试 fixture 或 Git；程序不会将环境变量中的 key 写入报告。

## 4. 退出语义

- `0`：一次完整业务结果；P0A.1 目前只有 owned-path hard gate 的 `reject` 能达到该状态；
- `1`：参数、目录、配置或兼容性错误，未开始有效 Trial；
- `2`：评测不完整；模型失败、预算超限、active Skill 被并发改变、合法 Candidate 尚无 Sealed Trial 等均走这里。

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
