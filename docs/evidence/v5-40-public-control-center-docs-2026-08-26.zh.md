# V5.40：公开安装文档与原生 Control Center 对齐

日期：2026-08-26

## 问题

运行时已把渠道健康从页面外固定面板迁到 DSH 原生 `conversation.view` 的 `控制台 → 渠道` Surface，但公开
安装指南和飞书/Gateway README 仍使用“侧栏渠道健康”以及旧的“Router 配置”说法。新用户按这些文字操作会找不到
入口，属于开源可用性缺陷；历史 evidence/research 页中的旧架构描述不改写。

## 修复

- `docs/getting-started.zh.md`、根 README、`dsh-feishu` 与 `dsh-gateway` README 统一说明原生 `控制台 → 渠道`。
- 安装前置同时列出已审计的 DSH rc.5 与当前 rc.2；示例将旧 Router 名称改为 `dsh-gateway`。
- `scripts/check-docs.mjs` 对操作文档拒绝旧侧栏/Router 渠道健康指引，但允许历史 evidence/research 文档保留事实记录。

## 证据

```text
pnpm run check:docs
Documentation links and public-path checks passed.
```

本增量只修正文档入口与防回归检查，不改变运行时、模型表面、权限、外部效果或 release gate 状态。
