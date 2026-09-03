# V5.90：Control Center 多挂载 ARIA 标识隔离（2026-09-04）

## 发现

统一 DSH `conversation.view` 控制面原先使用固定的 `dsh-cc-tab-*` 和 `dsh-cc-panel` DOM id。
DSH 在切换 Session、恢复页面或测试多个原生 view 同时存在时，可能短暂挂载两个控制面；固定 id 会让
`aria-controls`/`aria-labelledby` 指向另一个 Session 的元素，造成键盘与读屏操作串台。

## 修复

- `ControlCenterView` 使用 React `useId()` 为每次挂载生成实例前缀；tab 与 panel 的 id 都在该实例内生成。
- 保留原有单页、原生 slot、Surface 数据和状态所有权；没有新增路由、Session、状态库或网页。
- 新增双挂载回归测试，验证 tab/panel id 唯一且每一对 ARIA 引用只指向自己的实例。

## 验证

开发和测试前重新 fetch DSH，确认官方最新 `origin/master` 为
`76fda729799fe9b3848dbe2c211d4b231032b81e`，工作树 clean；运行时支持基线仍为可构建的 alpha.5
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

```sh
DSH_DIR=<path-to-deepseek-harness>
git -C "$DSH_DIR" fetch origin --tags --prune
test "$(git -C "$DSH_DIR" rev-parse HEAD)" = "$(git -C "$DSH_DIR" rev-parse origin/master)"
pnpm --filter dsh-control-center typecheck
pnpm --filter dsh-control-center exec vitest run --maxWorkers 1 \
  test/control-center-view.client.test.tsx test/client-module-contract.test.ts
pnpm --filter dsh-control-center build
```

结果：Control Center 类型检查通过；定向测试 2 个文件、5/5 通过；Node/Client 产物构建和 artifact 校验通过。

随后在同一 clean DSH alpha.5 支持基线下执行根级完整检查，明确退出码为 `0`：

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=<path-to-built-dsh-alpha5> pnpm run check
```

该检查覆盖 DSH preflight、文档/CI/套件与发布结构合同、12 个 Bundle 的 typecheck/test/build、assembled
clean-profile 生命周期和所有现有故障恢复夹具；没有把真实 Feishu、真实 Provider、Hermes paired 或长期效果
门误报为通过。

## 发布边界

这是多挂载可访问性和 Session 隔离修复，不是外部渠道、Provider、Hermes paired、长期效果或 release tag 的
通过证据；这些门仍按 `release-gates.json` 保持阻塞。
