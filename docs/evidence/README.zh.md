# 证据索引

这里仅保留仍参与当前设计或发布判断的维护者证据。它不是用户手册，也不保存逐次调试日记；被取代的记录从
工作树删除，需要追溯时使用 Git 历史。

## 当前工程基线

- [默认产品安装、Case Pack 契约与文档重置](v5-228-product-install-and-document-reset-2026-09-05.zh.md)：本轮
  clean-profile、全仓回归和删除范围。
- [最新 DSH 审计](../research/dsh-latest-audit-2026-09-11.zh.md)：canonical latest 的安装、上游构建与迁移阻断。
- [DSH rc.2 clean-profile readback](v5-230-dsh-rc2-clean-profile-readback-2026-09-11.zh.md)：current master 的
  build、原生 handle readback 与迁移前的 Session v3 失败定位。
- [Session v3 普通 direct-turn 证据](v5-231-session-v3-direct-turn-attestation-2026-09-11.zh.md)：embedded stream、
  request control、Generation/Routing receipt 与 alpha.5 双 cohort 回归。
- [Interaction Session 双 persistence reader](v5-232-session-persistence-dual-read-2026-09-11.zh.md)：alpha.5
  `readFrom`、current `open/read/close`、lifecycle deadline、logical header identity 与真实 receipt match。
- [最新可构建支持组合全量检查](v5-221-latest-dsh-full-check-2026-09-04.zh.md)。
- [套件打包与单页浏览器路径](v5-173-suite-pack-and-single-page-browser-2026-09-04.zh.md)。
- [clean-profile 全仓回归](v5-175-full-check-after-suite-packer-fix-2026-09-04.zh.md)。
- [单页 Control Center 真实浏览器复验](v5-196-single-page-control-center-live-revalidation-2026-09-04.zh.md)。

## 当前外部门禁

- [registry 名称迁移与所有权阻断](v5-171-public-package-name-migration-2026-09-04.zh.md)。
- [真实飞书：连接成功但无入站事件](v5-149-real-feishu-as2-valid-credential-no-pending-2026-09-04.zh.md)。
- [真实飞书：原生凭据与 WebSocket ready](v5-184-feishu-native-credential-live-websocket-2026-09-04.zh.md)。
- [Telegram 真实验收合同](v5-144-telegram-as1-real-contract-2026-09-04.zh.md)与
  [本地 assembled 配对回归](v5-223-local-pairing-assembled-regression-2026-09-04.zh.md)。
- [双真实 Provider 验收入口](v4-55-real-provider-acceptance-gate.zh.md)。
- [Hermes 当前冻结对照切片](v5-224-current-hermes-benchmark-suite-2026-09-04.zh.md)。

## 自我进化关键证据

- [Candidate 冻结后才生成 private holdout](p0a-8-private-heldout.zh.md)：早期但仍约束当前治理边界的关键证据。
- [Capability Gap Routing 与 authoring qualification](v5-229-capability-gap-routing-authority-2026-09-11.zh.md)：
  自有 Gap Tool 的 completed-turn 权威链、独立 Routing receipt、慢环资格 sidecar，以及 RP-1 当前付费阻断。

`passed` 只表示单个文件明确声明的范围通过。`partial`、`not-run`、`blocked`、确定性 fixture 或缺少真实外部
系统的结果都不能升级为发布结论；机器可读门禁以仓库根目录 `release-gates.json` 为准。
