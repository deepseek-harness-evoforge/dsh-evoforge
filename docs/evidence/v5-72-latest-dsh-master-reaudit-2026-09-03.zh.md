# V5.72：最新 DSH master 复核证据（2026-09-03）

## 目的

本证据记录本轮继续开发前对 DeepSeek Harness 最新远端状态的复核，防止把旧 revision 或上游部分构建产物
误当作当前支持基线。它不把 DSH 的上游构建失败转移给 EvoForge，也不提升任何真实渠道、Provider 或 Hermes
paired 发布门。

## 固定 revision

| 对象 | revision / tag | 结论 |
|---|---|---|
| 最新远端 `master` | `76fda729799fe9b3848dbe2c211d4b231032b81e` / `dsh-v0.1.2-rc.1-99-g76fda72979` | clean checkout；依赖安装通过，根级完整构建被上游 tsdown 入口阻断 |
| 最新公开 tag | `a66e4702047846cdaa10c66c9d3df3951f5ea70d` / `dsh-v0.1.2-rc.1` | clean checkout；依赖安装通过，根级完整构建被同一上游入口阻断 |
| EvoForge 可构建支持基线 | `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` / `dsh-v0.1.2-alpha.5` | 既有 assembled、clean-profile 和兼容矩阵继续有效 |

## 复核命令

在 DSH 的本地 checkout（例如 `deepseek-harness`）执行：

```sh
git fetch origin --tags
git rev-parse HEAD
git describe --tags --always --dirty
git status --short --branch
```

结果为 `76fda729799fe9b3848dbe2c211d4b231032b81e`、
`dsh-v0.1.2-rc.1-99-g76fda72979` 和 clean `master...origin/master`。

对公开 tag 与 master 的 clean checkout 均执行：

```sh
pnpm install --frozen-lockfile
pnpm build
```

`pnpm install --frozen-lockfile` 通过；`pnpm build` 在
`@deepseek-ai/dsh-root` 缺少 `lib/types/{index,invariant,startup}.js` 入口处失败。这是 DSH 上游根级
tsdown 配置/产物问题；EvoForge 没有修改 DSH，也没有把部分 `lib` 目录当成 release 产物。

## EvoForge 侧一致性门

本轮在仓库 `main` 执行：

```sh
pnpm run check:docs
pnpm run check:ci
pnpm run check:suites
```

结果：文档链接通过；CI test-path、DSH target、assembled build、typecheck-preflight 和 revision-matched
fixture 检查共 25 个引用文件通过；套件 manifest/pack 合同 3/3 通过。上述检查只证明仓库契约一致，不能
替代真实 Feishu、真实 Provider、Hermes paired 或长期效果证据。

## 决策

在 DSH rc.1/master 上游 clean build 修复、并重新完成完整安装/运行时矩阵前，继续用 alpha.5 做可复现的
assembled/clean-profile 测试；所有证据同时记录 tag、master 和实际运行基线。支持范围不扩大，不创建发布 tag。
