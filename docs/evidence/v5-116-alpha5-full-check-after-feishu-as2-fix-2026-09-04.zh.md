# V5.116：Feishu AS-2 overlay 修复后的 alpha.5 全量回归

## 结果

在 canonical DSH 最新 master fetch/clean preflight 后，使用已审计可构建的 DSH alpha.5 支持基线执行根级完整检查。
命令最终 `CHECK_RC=0`。本轮覆盖文档、CI/套件清单、发布合同、DSH 兼容矩阵、Hermes EV-1 类型检查、Provider/RP-1
合同、Feishu AS-2 合同、12 个包的 typecheck、全部测试和全部构建。

关键计数：Evolve `69 files / 309 tests`、Gateway `8 / 40`、Feishu `18 / 46`、Telegram `8 / 29`、Evolution Web
`2 / 27`、Doctor `5 / 40`、Control Center `2 / 5`；Resident 的既有 skipped 测试保持原状。AS-2 类型检查与安全合同
`10/10` 通过。

## 固定环境

- canonical DSH 最新 `origin/master`：`76fda729799fe9b3848dbe2c211d4b231032b81e`，工作树 clean；
- EvoForge：`main`，提交 `a110578`，工作树 clean；
- assembled DSH：`/private/tmp/evoforge-dsh-latest.qPqo1d`，版本 alpha.5，revision
  `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`；
- 完整日志保存在本机临时目录，未把凭据或临时 token 写入仓库。

## 口径

这是本地工程回归，不是发布或 Hermes 上位替代证明。`release-gates.json` 中 npm 名称归属、真实 Feishu AS-2、
真实 Provider、Hermes paired、长期效果和外部 Telegram 仍未通过；不得创建首个 SemVer tag。真实 Feishu 最近一次
运行已到达官方传输 ready，但因没有测试账号私聊而 fail closed，详见 [V5.115](v5-115-feishu-as2-official-transport-no-pending-2026-09-04.zh.md)。
