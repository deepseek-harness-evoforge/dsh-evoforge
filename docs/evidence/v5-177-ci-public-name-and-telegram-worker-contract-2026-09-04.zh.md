# V5.177：CI 公开包名与 Telegram 测试并发契约修复

日期：2026-09-04  
EvoForge 基线：`deb3b6d`（本轮变更随后原子提交）  
Canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`HEAD == origin/master`，clean  
DSH 最新公开 tag：`dsh-v0.1.2-rc.1`（`a66e470…`）  
组装测试支持基线：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（`0.1.2-alpha.5`）

## 发现

V5.171 已把 Doctor、Gateway、Feishu、Telegram 的 npm 分发名迁移到 `dsh-evoforge-*`，但
`.github/workflows/ci.yml` 仍有三个 `pnpm --filter` 使用旧 workspace 目录名。和 V5.173 的套件打包故障相同，
这些过滤器不会匹配公开包，公开仓库 CI 因而不能执行预期测试。

把过滤器修正为公开包名后，实际运行 Telegram 的四个 CI 测试又稳定复现第二个问题：
`package-install-remove.e2e.test.ts` 内的 `pnpm pack` 会通过 `prepack` 执行 `tsdown --clean`，与
`cache-composition.e2e.test.ts` 并行时短暂删除共享的 `dist/index.mjs`。最小两文件组合失败 `1/2`，
错误为 `ERR_MODULE_NOT_FOUND`；两个文件分别单跑均通过 `1/1`，排除了初始构建缺失和测试逻辑本身失败。

## 修复

- GitHub Actions 的 Doctor 两处过滤器改为 `dsh-evoforge-doctor`，Telegram 改为
  `dsh-evoforge-telegram`；
- Telegram CI 调用继承包清单中已有的 `--maxWorkers 1`，防止 `prepack` 清理工作区产物时与另一个组装测试并行；
- `check-ci-test-paths.mjs` 现在读取所有 workspace `package.json`：
  - 拒绝已经迁移、但 CI 仍按目录名调用的过滤器；
  - 拒绝不能解析到任一公开包名的过滤器；
  - 当包的 `test` 脚本声明 `--maxWorkers N` 时，拒绝 CI 直接调用 Vitest 却绕过该限制。

这没有把整个 CI 串行化，也没有改变产品 Runtime。限制只作用于已证明会竞争同一构建目录的包级测试。

## 红绿验证

修复前，最小实际复现：

```text
pnpm --filter dsh-evoforge-telegram build
DSH_EVOLVE_DSH_SOURCE_DIR=<alpha5> pnpm --filter dsh-evoforge-telegram exec vitest run \
  test/cache-composition.e2e.test.ts test/package-install-remove.e2e.test.ts
```

结果：退出 `1`；`1 failed | 1 passed`，缺失 `packages/dsh-telegram/dist/index.mjs`。

隔离运行两个文件：各自 `1/1` 通过。

修复后，以 CI 的 worker 限制重跑同一最小组合：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=<alpha5> pnpm --filter dsh-evoforge-telegram exec vitest run \
  --maxWorkers 1 test/cache-composition.e2e.test.ts test/package-install-remove.e2e.test.ts
```

结果：`2/2` 通过。

完整 Telegram CI 子集：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=<alpha5> pnpm --filter dsh-evoforge-telegram exec vitest run \
  --maxWorkers 1 \
  test/cache-composition.e2e.test.ts \
  test/dsh-assembled-chat.e2e.test.ts \
  test/pairing-assembled.e2e.test.ts \
  test/package-install-remove.e2e.test.ts
```

结果：`4/4` 通过。`pnpm run check:ci` 通过，覆盖工作流引用的 `26` 个测试路径及新增的包名/并发契约。

## 边界

本轮证明 GitHub CI 能按正确分发名选择包，并消除一个真实共享产物竞态；不增加任何真实渠道、Provider、
Hermes paired 或长期效果证据，不改变发布门禁状态，也不创建 tag。
