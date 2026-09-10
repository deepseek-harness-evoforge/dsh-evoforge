# DSH 最新版本审计（2026-09-11）

这是本轮开发前对官方仓库 `origin/master` 的审计。它区分“上游可构建”“局部 assembled 路径可运行”和
“EvoForge 已支持”三个结论；前两项通过不等于第三项。

## 固定事实

| 项目 | 值 | 结论 |
| --- | --- | --- |
| 来源 | 官方 `deepseek-harness` 独立 detached worktree | 未修改上游源码 |
| revision | `c291e7961a515f6d7af9304e7fd1d257929aef26` | 与 `origin/master` 一致 |
| 版本 | `0.1.5-rc.2` | current master 的 CLI 版本 |
| 最新 tag | `dsh-v0.1.5-rc.2` / `fb2c4b9e698e30edb738bca4cf0618587db7d203` | tag 与 master 分别记录，不混为同一 revision |
| 工作树 | clean | 没有 EvoForge 或调试改动 |
| install | exit 0 | `pnpm install --frozen-lockfile --ignore-scripts` 通过 |
| build | exit 0 / `passed` | 官方根构建通过 |

完整审计命令为：

```text
pnpm run audit:dsh:latest -- \
  --source <clean-c291e796-worktree> --json
```

因此 2026-09-05 审计中 `0.1.3-alpha.1` 的上游 `dsh-root` 构建阻断已经成为历史事实，不能继续描述为
canonical latest 的当前状态。

## 兼容性取样

在同一个 freshly built、clean `c291e796…` worktree 上，本轮还运行了现有兼容接缝：

- Doctor 合同 24/24 通过；
- software-delivery clean-profile 与 suite-upgrade 合计 2 passed / 1 skipped；其中当前 assembled 路径完成 packed
  Bundle add、dump、boot、原生 Session/Goal/Tool、flush/dispose、remove、handle-based Session readback 和再次 CLI boot；
- Feishu 四个兼容文件 5/5 通过；
- Generation binder 只有 2/6 通过，四个正例都以 `turn-structure-invalid` fail closed。

clean-profile 原生 readback 的旧测试曾把 `SessionHandle.read()` 误当成事件数组；当前 DSH 实际返回
`{ eventState, events }`。测试适配现在读取 `.events` 并在 `finally` 关闭 handle，alpha.5 的 `load()` fallback 保持不变。

## 尚未形成支持声明的边界

当前 DSH 已从 Session format v0 演进到 v3：顶层 `assistant/chunk` 改为 `assistant/message.data.stream`，失败尝试使用
`assistant/attempt`；Session persistence 改为 handle API；PTC event tag 和 surface replacement 坐标也发生变化。
EvoForge 的 Interaction projector、部分 persistence consumer、PTC 识别、dialect 标识、依赖版本与兼容矩阵尚未作为
一个完整 cohort 迁移。

因此当前支持基线仍是完整验证过的 `dsh-v0.1.2-alpha.5` / `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
`c291e796…` 现在是“latest audited + upstream buildable + 局部 assembled 取样”，不是 EvoForge supported runtime。
必须先完成 Session v3/persistence/PTC/dialect/pin 的一致迁移，再重跑 typecheck、pack、官方 add/dump/boot、
reload/dispose、Session 恢复、Web/渠道和卸载矩阵，才能改变支持声明。

本轮命令、范围、结果与限制见
[V5.230](../evidence/v5-230-dsh-rc2-clean-profile-readback-2026-09-11.zh.md)。
