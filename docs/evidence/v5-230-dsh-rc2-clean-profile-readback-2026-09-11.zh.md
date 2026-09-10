# V5.230：DSH rc.2 构建审计与 clean-profile readback

- 日期：2026-09-11
- EvoForge 基线：`7a4cd54c9ffeb11335b9b79d27b027ba14960a1d`；测试适配与本文位于同一后续提交。
- DSH master：`c291e7961a515f6d7af9304e7fd1d257929aef26`，CLI `0.1.5-rc.2`，clean，且与
  `origin/master` 一致。
- 最新公开 tag：`dsh-v0.1.5-rc.2` / `fb2c4b9e698e30edb738bca4cf0618587db7d203`；本轮运行对象是
  上述 master revision，不把 tag commit 和 master 混写。
- 范围：本地官方 checkout、安装/根构建、确定性插件合同与 macOS arm64 clean-profile assembled；没有真实渠道、
  真实 Provider、Hermes paired、长期 soak 或发布验证。

## 上游审计

```text
pnpm run audit:dsh:latest -- \
  --source <clean-c291e796-worktree> --json
```

结果：revision 与 `origin/master` exact match，工作树 clean，`pnpm install --frozen-lockfile --ignore-scripts` exit 0，官方根构建
exit 0，分类为 `passed`。旧本地 checkout 出现的 Landlock、storage-domain、open-in-app/UI/workspace 和
`session/chunk-rows` 缺失来自 ignored/stale 或未构建的 `lib` 产物；freshly built current checkout 不复现，EvoForge
没有为这些现象增加依赖或修改 DSH。

## clean-profile readback

```text
DSH_EVOLVE_DSH_SOURCE_DIR=<clean-c291e796-worktree> \
  pnpm --filter dsh-software-delivery exec vitest run \
  test/clean-profile-suite.e2e.test.ts test/suite-upgrade.e2e.test.ts \
  --maxWorkers 1
```

结果：2 passed / 1 skipped。当前 assembled 用例打包并安装 12 个 EvoForge Bundle，通过官方 add/dump/boot，执行
真实 DSH Session、Goal 与 EvoForge Tool，flush 后 dispose，卸载全部 Bundle，重新 boot，并从原生
SessionPersistence handle 读取 Goal complete 事件；随后 CLI Host 再次成功启动。skip 是既有历史 suite-upgrade fixture，
不被计为通过。

本轮红测的唯一 readback 失败是 `TypeError: restoredEvents.some is not a function`：current
`SessionHandle.read()` 返回 `{ eventState, events }`，旧测试按 alpha.5 数组读取。修复只位于 assembled 测试适配：
current 分支读取 `.events` 并以 `finally` 关闭 handle；pinned alpha.5 的 `load()` fallback 和产品代码均未改变。

## 兼容性取样与阻断

同一 DSH checkout 上：Doctor 24/24、Feishu 四文件 5/5 通过；Generation binder 为 2 passed / 4 failed，四个失败
均为 `turn-structure-invalid`。捕获的 current turn 使用 Session format v3 的 embedded assistant stream，不再产生
alpha.5 顶层 chunk citations。这证明上游 buildable 和单条 clean-profile 生命周期可运行，但不能证明 EvoForge 完整兼容。

支持矩阵继续固定 `dsh-v0.1.2-alpha.5` / `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。在 Session v3
projector、handle persistence consumer、PTC tag、dialect、11 个包的 peer/dev pin、lockfile 与 CI/兼容矩阵作为一个
cohort 迁移并通过完整 assembled 门前，不得把 `c291e796…` 宣称为 supported runtime。

本证据只关闭“canonical latest 是否干净可构建”和“当前 handle readback 是否能完成 clean-profile 生命周期”两个问题；
它不关闭 Web reload/browser、真实 Feishu/Telegram、真实 Provider、进化长期效果、registry 或 release gates。
