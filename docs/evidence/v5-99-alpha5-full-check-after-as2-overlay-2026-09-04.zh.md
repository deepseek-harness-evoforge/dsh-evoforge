# V5.99：AS-2 启动输出修复后的 alpha.5 根级完整回归

## 范围

本轮验证 V5.98 的非交互 AS-2 启动输出覆盖没有破坏插件组的工程质量。检查仍固定在已审计、可构建的
DSH alpha.5 支持基线；最新 DSH `master` 的上游根级入口缺失问题仍单独记录，不被本项目静默绕过。

## 前置审计

开发和测试前重新 fetch DSH，确认官方最新远端 `origin/master` 为
`76fda729799fe9b3848dbe2c211d4b231032b81e`，checkout clean；assembled runtime 使用
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（版本 `0.1.2-alpha.5`）。

## 命令与结果

```sh
DSH_DIR=<path-to-deepseek-harness>
git -C "$DSH_DIR" fetch origin --tags --prune
test "$(git -C "$DSH_DIR" rev-parse HEAD)" = "$(git -C "$DSH_DIR" rev-parse origin/master)"
test -z "$(git -C "$DSH_DIR" status --short)"
DSH_EVOLVE_DSH_SOURCE_DIR=<path-to-clean-alpha5> pnpm run check
```

结果为退出码 0：

- 文档、CI、套件清单、发布门合同、工作流和 DSH 兼容性检查通过；
- Hermes EV-1、Provider RP-1 与 Feishu AS-2 合同检查通过（均为本地合同，不代表现实外部门通过）；
- 所有工作区包 typecheck、测试和构建通过；其中 `dsh-evolve` 为 69 个文件/309 个测试，
  `dsh-gateway` 为 8/40，`dsh-feishu` 为 18/46，`dsh-telegram` 为 8/29，`dsh-evolve-web` 为 2/27；
- 所有 Node/TypeScript 产物校验通过，V5.98 的 AS-2 overlay 没有引入回归。

## 发布边界

这次是可重复工程回归，不是现实渠道验收。`real-feishu-as2` 仍因此前隔离运行未观察到当前 App 的陌生
私聊 pending request 而 failed；双真实 Provider、同模型 Hermes paired、长期效果、真实浏览器失败恢复和
首个 annotated SemVer tag 仍未通过。根目录 `release-gates.json` 未因本证据改变。
