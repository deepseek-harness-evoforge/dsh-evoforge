# V4.49 缺失 Skill Canary 回滚的最终 tarball 浏览器生命周期

日期：2026-08-21
状态：`verified`（最终 tarball 的 future-Session 晋升、failed-Outcome Canary、断连保留、精确回滚、冷恢复与官方卸载已验证；两套独立真实 provider、长期率、真实飞书 exact route 与 Hermes 同条件 paired benchmark 尚未完成）

## 本增量回答的问题

V4.31–V4.32 已实现缺失 Skill Candidate 的 failed-Outcome Canary 与独立 expected-active rollback gate，但最终发布包的真实 Web 证据仍不完整。V4.49 从最终 `dsh-evolve`/`dsh-evolve-web` tarball 和全新 DSH profile 出发，验证用户对内部经验形成的完整 `skill-bundle` Generation 所做的晋升与回滚确实经过生产 Host owner，并在断连、整页刷新、进程重启和卸载后保持精确状态。

## 固定对象与测试边界

- DSH revision：`47f943859bef60e4160492346772ded9b24f765a`。
- 验收起点：`main@3bdf8c840ab43c53a13617ccabec23696d748928`。
- `dsh-evolve-0.1.0-alpha.1.tgz`：`sha256:55145e037cff808b6c99979502dec2bd7feb6b62494bcf628c879d0909cc0e93`。
- `dsh-evolve-web-0.1.0-alpha.1.tgz`：`sha256:2218ee83be1e3f067a744f550dd726e8efd7c30a0719e7cf761794a0510e92c1`。
- 浏览器 fixture 是 test-only overlay，不进入两个 tarball。它准备 exact Opportunity、Evidence Seal、Candidate、Admission、Shadow、Retention、Review 与 terminal Canary durable evidence，但禁止调用 promote 或 rollback；两个 mutation 均由最终 Web → 固定 Typert Remote → Control → 独立 Host gate 完成。
- Canary fixture 只在真实 Web 已把 exact inactive `skill-bundle` 晋升为 active Generation 后写入 terminal evidence；它没有 Generation pointer writer，不冒充真实 provider 效果。

## 真实浏览器结果

1. 用 DSH 官方 `plugin --profile web add` 将两个最终 tarball 安装到全新隔离 profile；`--dump-config` 显示最终包的 Typert Loader、Host Bundle、Client Module 和 test-only overlay，真实 Host 在 `127.0.0.1:43849` 启动。
2. Skills/高级视图显示 `publish-dsh-plugin` 的 exact retained Candidate、Retention 和“可供未来 Session 晋升”；真实 Web 二次确认后调用生产 `FutureSessionPromotion`，概览变为 1 个进化 Skill 正在使用，页面明确只用于该 Workspace 的新 Session。
3. 同一 profile/端口冷重启后，fixture 只在权威 active pointer 精确匹配 Candidate 时生成 terminal Canary。Host 权威视图显示 baseline pass、Candidate fail、4 Trial、pointer/input/composition/calibration 全稳定、proposer 0、Candidate 无发布权，以及唯一“使用此证据回滚”动作。
4. 在二次确认后、Remote mutation 前停止 Host。页面明确显示 `evoforgeEvolution/rollback failed: Failed to fetch`，同时保留上一份 Canary、活动 Generation、模型/token/cache 与完整性证据；失败没有被伪装成成功，也没有清空最后成功快照。
5. 同一 profile/端口恢复后重新发起 exact Canary 回滚。独立 `FutureSessionRollback` 重验 Canary、Review、Generation artifact、Lineage、Shadow、Retention 与 expected-active pointer 后完成 root rollback；`publish-dsh-plugin` 从“正在使用”退回“已验证，等待启用”，当前 Session 不漂移。
6. Canary 历史 verdict 保留作审计证据，但回滚按钮消失，因为活动 Generation 已不再匹配。再次 Host 冷重启后仍是 `waiting=true`、`active=false`、`rollback-action=false`，浏览器 console error 数为 0。
7. DSH 官方 `plugin --profile web remove dsh-evolve-web dsh-evolve` 后，profile 只剩官方 base/web bundles，两个 `node_modules` 入口均不存在，默认 dump 的 `dsh-evolve|evoforge` 计数为 0；不带 overlay 的原生 DSH Web 在 `127.0.0.1:43850` 启动，真实浏览器显示原生“设置”而无“演化”入口，console error 数为 0。

## 自动化、卸载环境与包边界

- `package-contract.test.ts` 固定 overlay 必须显式启用 missing-Skill Canary fixture、包含 terminal result schema，并禁止 fixture 调用 `.rollback(...)` 或 existing-Skill mutation seams；`dsh-evolve-web` 的 22 项契约测试通过。
- fixture 在 active exact Candidate 时才准备 Canary；回滚后的冷重启不会重新激活 Generation，也不会重新产生可执行回滚动作。
- 首次官方 remove 因验收 profile 原先由 pnpm 10.28.1 链接、当前 Corepack 默认 pnpm 11 且 store 位置不同而 fail closed；恢复原 package manager 与 exact store 上下文后，同一官方 remove 成功。该失败没有手工删除 profile 文件，也没有掩盖卸载后 readback。
- 本页所述浏览器和卸载步骤直接针对上述最终 tarball；确定性 fixture 只构造密封证据，不进入发布包，也不拥有生产 mutation authority。

## 尚未证明

- 本次 deterministic durable fixture 不是两套独立真实 provider 的 paired Trial，不能给出长期误晋升、负迁移、遗忘或误回滚率。
- 当前环境未配置 `DSH_EVOLVE_MODEL_API_KEY`、`DSH_EVOLVE_GOVERNANCE_MODEL_API_KEY`、飞书 App 凭据或 live pairing 凭据，因此不能执行两套真实 provider 与真实飞书用户闭环。
- exact 飞书用户消息/回复/Approval、同任务/模型/权限/预算 Hermes paired epoch 与长期 Outcome 统计仍阻止 tag 和“上位替代完成”声明。
