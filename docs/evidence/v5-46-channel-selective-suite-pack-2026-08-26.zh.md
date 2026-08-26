# V5.46：单渠道套件打包精简证据

> 日期：2026-08-26；提交：`7710b11`；状态：`verified`

## 目的

`channels` 套件原本同时包含 `dsh-gateway`、`dsh-feishu` 和 `dsh-telegram`。本增量增加安装层
筛选参数，让只使用一个平台的部署者不必安装未使用的 Adapter；不改变 DSH Bundle、Gateway、凭据或
生命周期边界。

## 实现

```sh
pnpm run pack:suite -- --suite channels --channel feishu --out <isolated-directory>
```

输出目录带有 `channels-feishu` 后缀，避免先后打包不同渠道时复用旧 tarball。生成的
`evoforge-suite.json` 明确记录 `channel: "feishu"`，且 `packages` 只有：

```text
dsh-gateway
dsh-feishu
```

`--channel telegram` 对称地产生 `dsh-gateway` 与 `dsh-telegram`。对非 `channels` 套件或未知渠道值，
manifest helper 在打包前拒绝。

## 验证

- `pnpm run check:suites`：2 tests passed；包含两个单渠道组合及非法参数拒绝；
- `pnpm run check:docs`：通过；
- `git diff --check`：通过；
- 使用隔离临时目录实际运行 Feishu 打包：2 个官方 tarball，manifest 渠道和包名与预期一致；
- `pnpm run check:release`：`Release preflight passed for 12 packages at 0.1.0-alpha.1`；
- 未启动 DSH Host、未读取凭据、未调用模型或外部平台。

## 边界

这只是发布/安装编排能力，不是把 Gateway 与平台 Adapter 物理合并，也不改变 `full` 套件、独立
disable/remove、权限隔离或真实渠道发布门禁。真实 Feishu、Provider、Hermes paired 和长期效果门禁
仍由 `release-gates.json` 单独约束。
