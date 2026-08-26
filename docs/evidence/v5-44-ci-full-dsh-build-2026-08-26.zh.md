# V5.44：双 DSH assembled CI 使用完整运行时与 Web 构建

日期：2026-08-26

## 发现

V5.41 将 macOS assembled job 从 DSH Host-only 构建改为 `build:lib`，解决了部分客户端入口在干净 runner 上缺失的问题。新的干净 runner 继续暴露两项遗漏：

- `dsh-software-delivery` 的进程崩溃测试直接加载 `@deepseek-ai/dsh-llm` 的 `lib/index.js`，仅执行当前 DSH 的库构建路径时该入口仍可能不存在；
- clean-profile 复核实际启动 DSH Web，`build:lib` 不会生成 `@deepseek-ai/dsh-web-frontend/dist`，因此 Host 在 `web-runtime` 阶段以 `frontend dist not built` 失败。

## 修复

`.github/workflows/ci.yml` 的两个审计 revision assembled job 现在执行官方 DSH `pnpm build`，即完整的 `build:lib` 加 `build:web`，在安装 EvoForge tarball 前生成所有运行时包入口和 Web frontend dist。`scripts/check-ci-test-paths.mjs` 同步固定该要求，防止以后退回只构建库的路径。

## 验证

- 在干净的 DSH rc.5 checkout `/tmp/dsh-rc5.IerI3l` 执行 `pnpm build` 成功；确认 `packages/llm/llm/lib/index.js` 和 `apps/web/dist/index.html` 均生成。
- `pnpm run check:ci` 通过。
- GitHub run `32964749648` 已证明 Node 22/24 的仓库检查和 DSH 构建前置继续通过；该 run 在修复提交前创建，assembled 生命周期仍因缺少 frontend dist 失败，不能据此宣称 CI 已绿。修复后续 run 才能提升证据等级。

本证据只说明构建环境可重复性，不提升 `clean-profile-lifecycle`、真实飞书、Provider、Hermes paired 或长期效果门。
