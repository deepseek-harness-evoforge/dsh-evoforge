# V5.175：套件打包修复后的最新 DSH 全仓回归

日期：2026-09-04  
EvoForge revision：`7450830`（本轮文档提交前的运行时基线）  
DSH canonical revision：`76fda729799fe9b3848dbe2c211d4b231032b81e`（`origin/master`，`dsh-v0.1.2-rc.1`）  
DSH assembled support revision：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（alpha.5）

## 执行

测试前重新确认 canonical DSH 已 fetch、`HEAD == origin/master` 且工作树干净；根级检查显式锁定已审计的
alpha.5 assembled support checkout：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/dsh-v0.1.2-alpha.5 pnpm run check
```

## 结果

退出码 `0`。DSH preflight、文档/CI/套件/发布脚本门禁和 assembled build 全部通过；各核心套件测试结果为：

| 区域 | 结果 |
| --- | --- |
| Evolution | 69 files / 309 tests passed |
| Evolve Web | 10 files / 27 tests passed |
| Feishu targeted contract | 4 files / 12 tests passed |
| Resident | 7 files / 17 passed，1 skipped（平台特定） |
| Doctor | 5 files / 40 tests passed |
| Attention | 5 files / 11 tests passed |
| Control Center | 2 files / 27 tests passed |
| Gateway | 8 files / 41 tests passed |
| Telegram | 9 files / 34 tests passed |
| Software delivery | 7 files / 34 passed，1 skipped；clean profile 1 passed，1 skipped |
| Feishu full package | 18 files / 50 tests passed |

类型检查、Typert 产物校验和所有 Bundle build 均通过。该回归覆盖了本轮按公开包名打包的变更，证明它没有
破坏 DSH 原生安装、运行或卸载契约。

## 边界

本轮只证明仓库工程回归在最新已审计 DSH 支持基线下全绿；`release-gates.json` 的 npm 归属、真实 Feishu/Telegram、
真实 Provider、完整 Hermes paired 和长期效果门禁不因本地全仓测试而自动通过，仍保持阻断，且没有创建或推送 tag。
