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
- Generation binder 在旧 projector 基线上只有 2/6 通过；完成本轮 Session v3 direct-turn projector 后，同一 exact
  checkout 为 6/6。首个正例还令 fixture adapter 显式发布 `systemPromptUpdate: in-history`，验证 current request context
  进入 transcript、request-control digest、qualification 和重开后的 Generation/Routing receipt 路径；随后加入的内部
  persistence reader 还通过 current `open/read/close` 对同一真实 Session 做物理 readback，并令 Host composer 命中这两类 receipt。

clean-profile 原生 readback 的旧测试曾把 `SessionHandle.read()` 误当成事件数组；当前 DSH 实际返回
`{ eventState, events }`。测试适配现在读取 `.events` 并在 `finally` 关闭 handle，alpha.5 的 `load()` fallback 保持不变。

## 尚未形成支持声明的边界

当前 DSH 已从 Session format v0 演进到 v3。EvoForge 现在对 format v0 与 format v3 使用显式 dialect：v3 human-first、
没有预排 next-step inject/steering context，且无 retry、replacement、compaction、PTC 的 settled direct turn 会严格展开
compact Assistant stream，核对 content/usage/replay/finish、AgentLoop 固定 System prompt source、request route 与
`systemPromptUpdate`；System head 必须先于请求输入，本 cohort 的后续 prompt append 也必须位于继承 request header
的后续 step 请求之前、真正改变有效 prompt 并绑定 effective `in-history` route；tail 存活后的请求也必须继续满足这两个
route 条件。reader 扫描目标 `turn/end` 之前的整个前缀；未知 required 或混合格式继续 abstain，只有显式
`ignorable: true` 的未知事件可以跳过。format v3 的 `assistant/attempt`/`llm/retry*`、surface replacement、
`compaction/*` 和 PTC cohort 尚未迁移。Interaction evidence resolver 已用 exact capability XOR 同时支持 alpha.5
`readFrom` 和 current `open/read/close` 的只读物理 cut，并对 open/read/close 设置 lifecycle deadline；该 deadline 不包含
此前的 `sessions.flush()`。Gateway handle result 与 durable-feedback 的 current live/cold/recovery consumer 已完成局部
兼容及双基线回归，见 [V5.233](../evidence/v5-233-gateway-feedback-persistence-2026-09-11.zh.md)；依赖版本、Case Pack
revision 和 CI/兼容矩阵仍没有迁移。current 全量 Evolve 的六个旧 Case Pack revision 门仍失败，不能改写为支持通过。

因此当前支持基线仍是完整验证过的 `dsh-v0.1.2-alpha.5` / `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。
`c291e796…` 现在是“latest audited + upstream buildable + 局部 assembled 取样”，不是 EvoForge supported runtime。
必须先完成剩余 Session v3/persistence consumer/PTC/pin 的一致迁移，再重跑 typecheck、pack、官方 add/dump/boot、
reload/dispose、Session 恢复、Web/渠道和卸载矩阵，才能改变支持声明。

构建/readback 基线见
[V5.230](../evidence/v5-230-dsh-rc2-clean-profile-readback-2026-09-11.zh.md)，direct-turn projector 与双 dialect
回归见 [V5.231](../evidence/v5-231-session-v3-direct-turn-attestation-2026-09-11.zh.md)与
[V5.232](../evidence/v5-232-session-persistence-dual-read-2026-09-11.zh.md)。
