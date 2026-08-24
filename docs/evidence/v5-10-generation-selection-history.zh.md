# V5.10 Generation 选择历史与最终包浏览器恢复

日期：2026-08-24
状态：`verified`（pointer mutation 的原子审计、授权绑定、冷恢复、Web 展示和卸载已验证；真实 Provider 长期效果与 Hermes paired 仍未完成）

## 本增量回答的问题

既有链路已经有 Retention、发布门、future-Session 晋升、Canary 和 expected-active 回滚，但活动指针只显示当前值，无法在重启后权威回答一次选择由哪个门产生、从哪个 Generation 变到哪个 Generation。V5.10 在现有 Workspace selection state 内增加内容寻址历史，不增加 Store、Runtime、Session、Goal、审批或事件平台。

## 实现与边界

- `GenerationSelectionEvent` 与活动指针在同一个 `workspace_states` put 中原子写入，sequence 单调，最多保留 100 条；重复晋升已活动版本不产生事件。
- 内部 Candidate 晋升绑定 exact Review/Retention id；existing-Skill 晋升绑定 Candidate/Release Decision id；两类 Canary 回滚绑定 exact Canary id；无 Canary 的紧急恢复明确标为 `explicit-human`。
- Store 冷恢复重验内容地址、Workspace、sequence、action/authority 组合和最后 revision；旧状态无历史字段时兼容为空，损坏历史 fail closed。
- 当前 Session pin 不变化。Control 只投影最近 20 条及有界计数；Web 不调用模型，不拥有 writer，并明确标注 `outcomeClaim: none`、`releaseAuthority: none`。

## 自动化证据

- Storage e2e：原生 DSH Storage Domain 中完成 root→Candidate 晋升、重复晋升幂等、Canary root rollback、既有 Session pin 保持、Store 关闭再打开后的指针/历史/pin 恢复。
- Gate tests：missing-Skill Retention、existing-Skill Release、显式人工、missing-Skill Canary、existing-Skill Canary 五类 authority 都必须传递 exact evidence；错误 action/authority 形状被 schema 拒绝。
- Control/Web：Host 概览按 sequence 倒序投影有界历史与分类计数；组件红绿测试验证前后 Generation、authority ids 和无效果/发布权声明。
- 固定 DSH `47f943859bef60e4160492346772ded9b24f765a` 重新生成 Typert Host/Remote 制品并通过 stale-artifact 校验。
- 根级 `pnpm check` 以退出码 0 完成文档与 Cache Contract 门禁、11 包 typecheck/测试/build；`dsh-evolve` 296 passed/1 skipped，`dsh-evolve-web` 26 passed，根级累计 555 passed/3 skipped。RP-1 8/8 与 AS-2 7/7 仅验证未授权时的 `NOT_RUN` 合同，没有读取身份/凭据或发起外部请求。

## 最终 tarball 真实 DSH Web 验收

- `dsh-evolve-0.1.0-alpha.1.tgz`：`sha256:c202690e3659cf1a3a09f7b43801af433f1f699d45d60993ed9733a9cebfe86a`。
- `dsh-evolve-web-0.1.0-alpha.1.tgz`：`sha256:317b2bf5af4697d84d31ecc02c73a15c67927dd1c76c09cfd6eda56850ecc06e`。
- 两个最终包由 DSH 官方 `plugin --profile web add` 安装到全新 profile；组合 dump 只通过 test-only overlay 准备 exact durable evaluation evidence，所有 promote/rollback mutation 仍由最终 Web → generated Remote → Control → Host gate 执行。
- 初始高级视图显示 0 条。真实 Web 晋升后显示 `#1 原生 DSH → 2bb53348…`，authority 为内部保持性门禁并带 Review/Retention 短 id；整页 reload 与 Host 冷重启后完全恢复。
- Host 重启后出现 exact missing-Skill Canary；真实 Web 二次确认回滚后显示 `#2 2bb53348… → 原生 DSH`，计数为 2 mutations / 1 promotion / 1 rollback / 1 Canary rollback / 0 explicit rollback，并绑定 Canary `9407e959…`。
- 回滚后的整页 reload 和第二次 Host 冷重启仍恢复两条记录，浏览器 console error 为 0。
- DSH 官方 remove 后两个 package entry 均不存在，profile 只保留官方 base/web bundle，默认 dump 的 `dsh-evolve|evoforge` 计数为 0；纯原生 Web 在新端口启动，显示“设置”且“演化”入口计数为 0，console error 为 0。

## 尚未证明

这条时间线证明 selection mutation 与 authority 的持久事实，不证明 Candidate 导致成功/失败，也不提供 false-promotion、false-rollback、Retention、遗忘或负迁移率。RP-1 两套真实 Provider、AS-2 真实飞书和同任务/模型/权限/预算 Hermes paired epoch 仍为发布阻断项，因此不创建 tag、不声明 Hermes 上位替代完成。
