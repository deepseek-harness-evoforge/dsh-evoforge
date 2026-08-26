# V5.29：兼容矩阵当前重跑记录（2026-08-26）

本记录补充 V5.16 的历史双版本证据，不覆盖历史事实，也不把一次失败重写成通过。

## 当前结果

| 目标 | revision | 结果 | 说明 |
|---|---|---|---|
| DSH `0.1.1-rc.2` | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` | `passed` | 使用当前 `main` 的 `pnpm test:dsh-compatibility`，doctor、software-delivery、evolve、feishu 四组兼容门全部通过。 |
| DSH `0.1.0-rc.5` | `47f943859bef60e4160492346772ded9b24f765a` | `blocked` | rc.5 checkout 可构建，doctor 契约通过；clean-profile 与 suite-upgrade 在测试前置/宿主装配处失败，尚不能作为当前代码的通过证据。 |

## rc.5 阻断的可复核原因

1. 当前 rc.5 Web CLI 已删除 `--no-open` 选项，而兼容测试仍把该选项传给 `dsh web`；Host 在 readiness 前以 `unknown option '--no-open'` 退出。这是测试与 DSH CLI contract 的漂移，不是把失败标成插件运行成功的理由。
2. suite-upgrade 临时 profile 的 Cordis loader 找不到 rc.5 宿主自带的 `@deepseek-ai/dsh-*` 包。该 profile 只安装 EvoForge tarball，需按 rc.5 最新官方宿主装配方式重新建立 fixture 后才能继续验证。

## 结论与后续门

- V5.16 的“两个目标各 30 项通过”是 2026-08-24 的历史快照；本记录把当前重跑结果单独保留。
- 当前发布基线可声明为：rc.2 已重验；rc.5 兼容性待修正测试 harness/clean-profile fixture 后重验。
- 在 rc.5 重验通过前，不创建 release tag，不宣称当前代码已完成双版本兼容。

