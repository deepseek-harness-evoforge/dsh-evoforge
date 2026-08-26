# V5.34 开源包元数据与 CI 发布预检证据

日期：2026-08-26

## 本次收口

- 为 `dsh-control-center` 增加可随 tarball 交付的包级 README；
- 每个公开 Bundle 都必须声明 MIT license、统一仓库地址、`README.md`、`cordis.patch.yml`；
- 每个 Bundle 必须在 `files` 中包含 Cordis patch、在 `exports` 中导出 patch，并在 `dsh.bundle.patch` 中声明同一路径；
- 根级 `pnpm check` 纳入 `check:suites`，避免公开安装面漂移；
- GitHub Actions 的 Node 22/24 矩阵增加无 dirty worktree 的 `check:release`；
- 英文 README 与当前 `core/channels/delivery/continuity` 默认安装面同步。

## 复核命令

```text
pnpm run check:docs
Documentation links and public-path checks passed.

pnpm run check:suites
2 tests passed.

pnpm run check:release -- --allow-dirty
Release preflight passed for 12 packages at 0.1.0-alpha.1

pnpm --filter dsh-control-center test
2 files passed, 4 tests passed.

pnpm --filter dsh-control-center pack --pack-destination <isolated-directory>
Tarball contents include cordis.patch.yml and README.md.
```

## 边界

这项预检证明第三方可以从仓库识别、打包和审计每个官方 Bundle；它不等于 registry 发布，也不替代 clean-profile
真实 DSH、真实 Provider、真实飞书完整 AS-2 或 Hermes paired 成果。当前版本仍保持 pre-alpha，未创建 release tag。
