# V5.96：alpha.5 支持基线根级质量检查

## 范围

本轮针对 main 上的 Feishu 事件边界与 Schedule 崩溃恢复夹具修复，重新执行完整工程检查。检查目标不是把
真实外部渠道或发布门“模拟”为通过，而是确认插件组在固定 DSH 运行时上的可重复工程质量。

## 前置审计

开发和测试前重新 fetch DSH，确认官方最新远端 `origin/master` 为
`76fda729799fe9b3848dbe2c211d4b231032b81e`，该 checkout clean。最新 master 的根级构建仍受上游入口缺失
阻断，因此 assembled runtime 使用已审计、可构建的 alpha.5 checkout：
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

- 文档、CI 路径、套件清单、发布门合同与工作流检查通过；
- DSH 兼容性脚本与 Hermes EV-1 类型检查通过；
- Provider RP-1 和 Feishu AS-2 合同检查通过（均为未授权时 fail-closed 的合同测试，不是现实外部运行）；
- 12 个工作区包全部 typecheck 和 build 通过；
- 全部测试通过，包含 `dsh-feishu` 18/18 文件、46/46 测试，`dsh-telegram` 8/8 文件、29/29 测试，
  `dsh-gateway` 8/8 文件、40/40 测试；
- 所有 Node/TypeScript 产物校验通过。

## 发布边界

根级质量检查绿灯不等于产品完成。真实 Feishu AS-2 仍因未观察到当前 App 的陌生私聊而 failed；真实双 Provider、
同模型 Hermes paired、长期负迁移/遗忘/恢复数据和真实外部浏览器完整恢复仍缺失。根目录
`release-gates.json` 未被本证据修改，首个 annotated SemVer tag 继续禁止。
