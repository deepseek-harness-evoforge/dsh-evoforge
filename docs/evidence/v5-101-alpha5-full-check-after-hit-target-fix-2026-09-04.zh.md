# V5.101：Control Center 鼠标命中修复后的根级完整回归

日期：2026-09-04

## 范围与版本

回归前重新 fetch 并确认最新 DSH `origin/master` 为
`76fda729799fe9b3848dbe2c211d4b231032b81e`，DSH 工作树 clean。最新 master 的根级 tsdown/plugin-module-table
缺陷仍属于上游事实，没有修改或掩盖；按已审计支持矩阵使用可构建 DSH alpha.5
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（`0.1.2-alpha.5`）。

## 命令与结果

```text
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
exit 0
```

通过项目包括：

- DSH preflight、文档、CI 路径、套件清单与 Browser overlay 合同；
- release-gates、release-tag、release-workflow 和 DSH compatibility 合同；
- Hermes EV-1、Provider RP-1、Feishu AS-2 合同/typecheck；
- 12 个插件包的类型检查、产物验证、测试与构建；
- `dsh-evolve` 69 个测试文件 / 309 个测试；
- `dsh-gateway` 8 / 40、`dsh-feishu` 18 / 46、`dsh-telegram` 8 / 29；
- `dsh-evolve-web` 2 / 27、`dsh-doctor` 5 / 40、Control Center 2 / 5。

## 结论

Control Center 根节点层级修复和浏览器夹具 workspace 初始化没有引入工程回归；工作树在回归结束后仍 clean，
没有创建分支或 release tag。该结果只证明当前支持基线的工程质量，不证明真实 Feishu AS-2、外部 Telegram、
真实 Provider、Hermes paired、长期效果或首个发布门已经通过；权威状态继续由根级 `release-gates.json` 阻断。
