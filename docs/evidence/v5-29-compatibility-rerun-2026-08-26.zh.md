# V5.29：兼容矩阵当前重跑记录（2026-08-26）

本记录补充 V5.16 的历史双版本证据，不覆盖历史事实，也不把一次失败重写成通过。

## 当前结果

| 目标 | revision | 结果 | 说明 |
|---|---|---|---|
| DSH `0.1.1-rc.2` | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` | `passed` | 使用当前 `main` 的 `pnpm test:dsh-compatibility`，doctor、software-delivery、evolve、feishu 四组兼容门全部通过。 |
| DSH `0.1.0-rc.5` | `47f943859bef60e4160492346772ded9b24f765a` | `passed` | 修正测试 harness 的 CLI 参数并先构建 rc.5 Web frontend 后，doctor、clean-profile、suite-upgrade、evolve、feishu 全部通过。 |

## 初始阻断与修复

1. 两个目标的 Web CLI 契约不同：rc.2 提供 `--no-open`，rc.5 已删除该选项。生命周期 harness 先读取目标 CLI 的 `--help`，仅在目标支持时传入 `--no-open`；rc.5 保持只传官方 `--port`，因此不会把已删除的 flag 传给旧目标，也不会因随机端口打开浏览器。
2. rc.5 Web Bundle 要求 frontend dist 已构建；重跑前执行 `pnpm run build:lib` 与 `pnpm run build:web`，按官方宿主装配方式建立完整 fixture。

## 结论与后续门

- V5.16 的“两个目标各 30 项通过”是 2026-08-24 的历史快照；本记录把当前重跑结果单独保留。
- 本次修正后的 clean-profile 与 suite-upgrade 均分别在 rc.2 和 rc.5 重跑通过；rc.2 的探针明确没有 `opening the default browser` 输出，rc.5 的帮助输出不含 `--no-open` 且同样通过。
- 当前发布基线可声明为：rc.2 与 rc.5 均已由当前 `main` 重验通过。
- 这只证明 DSH 兼容与生命周期门，不替代真实 Provider、飞书完整 epoch-3、浏览器迁移和 Hermes paired 发布门。
