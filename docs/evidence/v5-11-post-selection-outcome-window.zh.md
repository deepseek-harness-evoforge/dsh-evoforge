# V5.11 Generation 选择后 Outcome 窗口与最终包浏览器恢复

日期：2026-08-24
状态：`verified`（有界 post-selection Outcome 关联、指标投影、歧义 abstain、Web 故障/冷恢复和卸载已验证；真实 Provider 长期效果与 Hermes paired 仍未完成）

## 本增量回答的问题

V5.10 已原子保留每次 future-Session Generation 选择，但选择历史只有 mutation audit。V5.11 复用现有不可变选择事件与 durable Delivery Outcome，在同一 Host Control 投影中回答“这次选择之后、下次选择之前，保留下来的真实结果分别来自 selected、previous 还是 other Generation”。它不新增 Store、Runtime、Session、Goal、审批或通用监测平台。

## 实现与边界

- 新的纯投影模块统一拥有选择历史排序、计数和 Outcome epoch join，`EvolutionControlPlane.overview` 是唯一公开读面；Web 没有 writer。
- 时间窗严格使用 `observedAt > selection.recordedAt` 且 `< nextSelection.recordedAt`。边界相等只计 ambiguous；相邻 wall-clock 非严格递增时整个窗口 abstain。
- Outcome 按自身 Session-pinned Generation 分成 selected、previous、other，分别聚合 passed/failed/unknown、不同 Goal 数、已测/未测和 DSH Goal metrics。
- 有界保留事实固定标记 `bounded-retained-evidence`、`causalClaim: none`、`mutationAuthority: none`；不改变 Candidate、评测、Retention、Canary、晋升或回滚。

## 红绿与自动化证据

- Host 首个红测因 selection item 没有 `outcomeWindow` 失败；实现严格窗口及三桶后转绿。
- Web 首个红测找不到“选择后保留的 Outcome 窗口”；组件、双语文案和指标卡实现后转绿。
- 第二个 Host 红测证明时间倒退时原实现仍错误显示 observed；补齐前后相邻事件的严格单调门后转绿。
- Host 覆盖 selected/previous/other、不同 Goal、passed/failed、measured/unmeasured、token/cache/latency/active-wall 和边界歧义；Web 精确断言三桶与指标。
- 固定 DSH `47f943859bef60e4160492346772ded9b24f765a` 重新生成 Typert Host/Remote 制品并通过 stale-artifact 校验。
- `dsh-evolve` 67 files/297 passed、1 file/1 skipped；`dsh-evolve-web` 2 files/26 passed。根级 `pnpm check` 完成文档、全包 typecheck/test/build，累计 556 passed/3 skipped。RP-1 8/8 与 AS-2 7/7 仍只验证未授权 `NOT_RUN` 合同，没有读取凭据或发起外部请求。

## 最终 tarball 真实 DSH Web 验收

- `dsh-evolve-0.1.0-alpha.1.tgz`：`sha256:c421f89aacb899ab000eb7c5c68e83de33fce8ae64ad4c806ce94bc6f6f4523b`。
- `dsh-evolve-web-0.1.0-alpha.1.tgz`：`sha256:299e20b892c3224760c66754f410fb4003f41517b27104a28f236625ab699499`。
- 两个最终包由官方 DSH CLI 安装到全新隔离 profile；test-only fixture 只通过原生 DSH Session 事件形成 Outcome，不直接写投影 Store，也不进入 tarball。
- 真实 Web 对一个 inactive existing-Skill Generation 完成确认式 promote；首次显示 mutation timeline 和零 Outcome 窗口。随后两个仍固定不同 Generation 的真实 Session 分别产生 selected passed/measured 与 previous failed/unmeasured Outcome。
- Host 权威窗口显示 selected `1 Goal / 1 passed`、previous `1 Goal / 1 failed`、other `0`、边界歧义 `0`；selected 显示 50 uncached input、10 output、80 cache-read、6 cache-write、LLM 80ms、tool 20ms、TTFT 20ms、active 120ms，previous 明确为 0 measured/1 unmeasured。
- Host 停机时 Refresh 显式 `Failed to fetch` 并保留最后成功快照；同 profile 恢复、第二次冷启动和整页 reload 均恢复同一窗口，浏览器 console error 为 0。
- 官方 remove 后两个 package entry 均消失；同端口原生 DSH Web 正常启动，“演化”入口为 0，“设置”仍存在，console error 为 0。

## 尚未证明

窗口只覆盖当前 Store 保留下来的 Outcome，既不完整也不证明 Generation 导致结果。它尚不能给出误晋升、负迁移、遗忘、误回滚或长期保持率。RP-1 两套真实 Provider、AS-2 真实飞书和同任务/模型/权限/预算 Hermes paired epoch 仍是发布阻断项，因此不创建 tag、不声明 Hermes 上位替代完成。
