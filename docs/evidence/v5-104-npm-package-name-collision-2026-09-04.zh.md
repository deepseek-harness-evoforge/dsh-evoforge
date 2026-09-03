# V5.104：npm 包名归属审计与发布阻断

日期：2026-09-04  
EvoForge：`main`  
范围：公开 Bundle 包名、npm 发布工作流和开源发布门

## 目的

源码元数据通过并不代表项目可以真正发布到 npm。未注册的包名可以被他人抢注，已注册的同名包则会让
`npm publish` 失败或把用户导向其他项目。本轮在继续开发前核对所有公开 Bundle 的 registry 状态，并把
结果变成 tag 前的机器门禁。

## DSH 前置审计

本轮开发/验证前先 fetch 最新 DSH，并确认 checkout 与 `origin/master` 对齐且干净：

```text
DSH_HEAD=76fda729799fe9b3848dbe2c211d4b231032b81e
DSH_MASTER=76fda729799fe9b3848dbe2c211d4b231032b81e
DSH_VERSION=0.1.2-rc.1
DSH_STATUS=<empty>
```

没有修改 DSH 上游源码；EvoForge 的可构建支持基线仍是 alpha.5。

## Registry 事实

使用 `npm view <package> --json` 查询当前 registry。十二个包中八个名称尚未注册，四个名称已经属于其他公开
仓库：

| 包名 | registry 状态 | 已注册版本 | registry 中的仓库 |
|---|---|---:|---|
| `dsh-doctor` | 冲突 | `0.4.3` | `astra3294/dsh-doctor` |
| `dsh-feishu` | 冲突 | `0.0.1` | `omdsh-dev/dsh-lark` |
| `dsh-gateway` | 冲突 | `1.7.0` | `clarknu/dsh-gateway` |
| `dsh-telegram` | 冲突 | `0.2.0` | `Gum97/dsh-telegram` |

其余 `dsh-control-center`、`dsh-evolve`、`dsh-evolve-attention`、`dsh-evolve-web`、`dsh-github-review`、
`dsh-goal-continuity`、`dsh-resident`、`dsh-software-delivery` 查询为 `E404`，仅表示当前未注册，不等于已经
获得项目所有权。

## 已实施的防错措施

- 新增 `scripts/check-npm-package-names.mjs` 与无网络依赖的分类测试；未注册返回 `available`，本仓库同源包返回
  `owned`，其他仓库或无归属包返回 `collision`，registry 超时/认证错误等未知结果 fail closed。
- 发布工作流在 tag 校验后、任何构建和 `npm publish` 前运行 `pnpm run check:release:names`。
- `release-gates.json` 新增 required gate `registry-name-availability`，当前诚实标记为 `failed`。
- 在没有获得 npm 组织/Scope 所有权前不自动重命名包，也不创建 release tag；避免把未经授权的假 Scope 当成可发布方案。
- 逻辑 Bundle id 与 npm 分发名的迁移边界固定见 [ADR-0101](../adr/0101-public-package-namespace-before-npm-release.md)，
  不把简单改 `package.json` 或本地 tarball 误认为完成命名迁移。

## 验证结果

```text
pnpm run check:release:names -- --json  # exit 1，4 个 collision，0 个 unknown
node --test scripts/check-npm-package-names.test.mjs scripts/check-release-workflow.test.mjs  # 5/5 passed
```

该增量解决“发布前才发现包名冲突”的工程盲区，但没有解决 npm 命名空间本身。首个公开 tag 仍被阻止；维护者
必须先为所有公开 Bundle 确定并获得项目拥有的命名空间，然后更新包名、内部依赖、套件清单、安装文档和升级/卸载
验收，再重新运行完整矩阵。
