# V5.218：最新 DSH 构建复验仍受上游 root 类型入口阻断

日期：2026-09-04  
范围：在提交 `50508a5` 之后重新 fetch 最新 DSH，并在任何后续开发/测试前复核 revision、安装和官方构建。

## 审计事实

- DSH 路径：当前机器上的独立 `deepseek-harness` checkout（证据不写入个人绝对路径）。
- `HEAD == origin/master == d347e703908d0406b7a7ef80e3a0e594d86b2215`，版本 `0.1.3-alpha.1`，工作树 clean。
- 官方 `pnpm install --frozen-lockfile --ignore-scripts --offline` 通过。
- `node scripts/audit-dsh-latest.mjs --source <latest-dsh-checkout> --json` 的构建结果为
  `status: 1`、`classification: blocked-upstream-root-types-entry`。

## 上游失败原因

官方 `pnpm build` 在 `@deepseek-ai/dsh-root@0.1.3-alpha.1` 的 `build:lib:host` 阶段失败：

```text
Error: [@deepseek-ai/dsh-root] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]
```

这是 DSH 当前公开 revision 自身的构建缺陷，不是 EvoForge 修改造成的。EvoForge 没有写入 DSH 工作树，
也没有把失败隐藏成“最新版本可用”。

## 对 EvoForge 支持矩阵的影响

继续使用已审计、可构建的 DSH alpha.5 支持 checkout
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` 执行 EvoForge 的完整类型、测试、构建和打包验证；同时保留
最新 canonical revision 的安装/源码审计记录。只有上游修复并重新通过同一审计，才可把支持矩阵切换到
`0.1.3-alpha.1`，不得仅因安装成功而放宽版本门。

本次复验未读取平台凭据、未连接 Feishu/Telegram、未产生外部消息或其他副作用。
