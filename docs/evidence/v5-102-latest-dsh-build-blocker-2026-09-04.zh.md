# V5.102：最新 DSH master 构建阻断复核

日期：2026-09-04  
EvoForge：`main`（提交 `7cd4702`）  
DSH：`origin/master` / `76fda729799fe9b3848dbe2c211d4b231032b81e`（版本 `0.1.2-rc.1`）

## 目的

按照项目纪律，开发前先 fetch 最新 DSH，并确认 checkout 与远端 `origin/master` 完全一致且工作树干净；随后直接运行官方根构建，确认当前最新源码能否作为 EvoForge 的 assembled 运行时，而不是继续使用过期 checkout 或把安装成功误报成可运行。

## 实际命令与结果

```sh
DSH_DIR=<dsh-checkout>
git -C "$DSH_DIR" fetch origin --tags --prune
DSH_HEAD=$(git -C "$DSH_DIR" rev-parse HEAD)
DSH_MASTER=$(git -C "$DSH_DIR" rev-parse origin/master)
test "$DSH_HEAD" = "$DSH_MASTER"
test -z "$(git -C "$DSH_DIR" status --short)"
pnpm --dir "$DSH_DIR" build
```

前四条 preflight 通过：

```text
DSH_HEAD=76fda729799fe9b3848dbe2c211d4b231032b81e
DSH_MASTER=76fda729799fe9b3848dbe2c211d4b231032b81e
DSH clean latest master preflight: PASS
```

官方 `pnpm build` 严格失败（exit 1）。失败发生在 DSH 自身 `build:lib:host` 的 tsdown 配置解析，而非 EvoForge 插件：

```text
ERROR Error: [@deepseek-ai/dsh-root] Cannot find entry:
["lib/types/{index,invariant,startup}.js"]
```

构建没有留下 DSH 工作树改动。该失败与此前的上游 module-table/client 入口问题属于同一“最新 master 尚不可 assembled 启动”的发布阻断面；本证据只记录事实，不修改或 fork DSH。

## 对 EvoForge 支持矩阵的影响

- 最新 DSH 已完成 fetch、revision 对齐和 clean 检查，但不能成为当前 assembled 运行目标。
- 已审计、可构建并通过完整工程检查的 DSH 支持基线仍是 `dsh-v0.1.2-alpha.5`，revision `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
- 本次失败不提升或降低任何真实 Feishu、Telegram、Provider、Hermes paired 或长期效果门；也不允许创建发布 tag。
- 待 DSH 上游修复并发布可构建 revision 后，必须重新执行 clean-profile 安装、dump、boot、真实 Session/Goal、reload/dispose、卸载和原生 Web readback，再决定是否扩大 peer/support range。

## 可复核性与安全

本次只读取 DSH revision/status 并运行官方构建；未读取或记录凭据、消息正文或外部平台数据，也未改动 DSH 上游源码。完整 EvoForge 回归仍使用显式 `DSH_EVOLVE_DSH_SOURCE_DIR` 指向 alpha.5 支持 checkout，并在命令开始执行同等 preflight。
