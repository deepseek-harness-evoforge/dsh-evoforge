# 当前状态

更新时间：2026-09-11。本文只保留当前结论和阻断；逐次命令与历史结果见 [evidence 索引](evidence/README.zh.md)。
状态词的含义见 [Hermes 对照记分卡](architecture/hermes-replacement-scorecard.zh.md)。

## 总结

项目仍是 pre-alpha。插件代码、Cordis 生命周期、套件打包和一部分 assembled 测试可复现；真实渠道、真实 Provider、
长期进化效果和同条件 Hermes paired 还没有形成发布证据。因此当前不能宣称“整体 Hermes 上位替代”，也没有稳定
npm registry 包或 SemVer release tag。

## 当前矩阵

| 范围 | 当前结论 | 状态 |
| --- | --- | --- |
| DSH 兼容 | master `c291e796…` / CLI 0.1.5-rc.2 已在 clean worktree 完成 install、根构建和关键兼容取样；handle readback 与严格的 Session v3 human-first direct-turn Generation binder 6/6 已通过，但 resolver persistence、retry/replacement/compaction/PTC、依赖 pin 和完整矩阵尚未成组迁移；完整支持组合仍为 0.1.2-alpha.5 | pinned alpha.5 verified；current direct-turn cohort verified, full migration blocked |
| 安装 | 默认 `product` 套件、一行仓库安装、exact manifest/SHA、持久内容地址、禁用依赖 install script 和配置输出保护已有合同 | clean-profile add/dump/boot/remove/reboot verified；registry 与当前 head reload/browser 未完成 |
| 插件契约 | 官方 Bundle/profile patch、生命周期、独立启停/卸载和套件打包有本地合同 | implemented / local verified |
| Gateway | Host 内常驻、pairing、路由、journal、幂等、uncertain、dispose 竞态有 assembled 证据 | verified locally; real soak pending |
| Feishu | 已有原生凭据/Adapter、配对和局部 direct-DM smoke；完整 AS-2（重启新消息、Approval/Schedule/group、撤销、长期重连）未齐 | partial |
| Telegram | Adapter、pairing assembled 和安全合同存在；真实 Bot AS-1 尚未完成 | partial |
| Evolution | Interaction-first 设计已冻结；自有 Gap Tool 的 exact completed-turn Routing receipt、Candidate/隔离评测/future-Session pointer/canary/rollback 有本地合同；Session v0/v3 的严格 human-first direct-turn projector 已贯通同一证据路径 | partial；Routing 只闭合一个 Episode 维度，latest DSH 完整 cohort 尚未迁移，普通 Interaction 仍未贯通完整慢环 |
| Provider 验收 | RP-1 epoch 2 只固定 manifest 并验证五条 qualified Gap fixture 形成一个 Opportunity；精确批准也会在读取 Provider 配置和私有路径前固定失败 | blocked：`runtime-attestation-incomplete`；没有当前 paid/passed 证据 |
| Web | 一个 Session-scoped native conversation.view 和 child slots 有局部浏览器证据；blank Session/onboarding 不渲染 slot，当前 profile 仍需 clean recheck | partial |
| Delivery/continuity | 公开 delivery 只含隔离交付；github-review 因 CredentialProvider 迁移未完成而阻断；Goal 冷恢复、Resident 协议有本地测试 | partial; real soak pending |
| Hermes paired | EV-1/SD-1/LC-1/AS-1 为冻结 deterministic/assembled slices，不等于模型质量或整体替代 | not-measured for full claim |
| Registry/release | 未发布 registry 包；没有通过所有 required gates 的 annotated tag | blocked |

## 最近可复核事实

- DSH latest audit（2026-09-11）：clean master `c291e7961a515f6d7af9304e7fd1d257929aef26` / CLI
  `0.1.5-rc.2` 的安装和官方根构建均 exit 0；最新 tag 为 `dsh-v0.1.5-rc.2` /
  `fb2c4b9e698e30edb738bca4cf0618587db7d203`。见[最新审计摘要](research/dsh-latest-audit-2026-09-11.zh.md)和
  [V5.230](evidence/v5-230-dsh-rc2-clean-profile-readback-2026-09-11.zh.md)。
- 同一 current master 上的 assembled clean-profile 原生 handle readback 已通过；Doctor 24/24、Feishu 5/5 通过。
  Session v3 human-first、无预排 next-step context 的 settled direct turn 现在严格验证 embedded stream、AgentLoop 固定
  System prompt source、`in-history` request context 与 request route；真实 source-aware Generation binder 在 current 与
  alpha.5 均为 6/6。另有同一 20 文件 / 448 tests 回归选择在两个 source selector 下全通过，但多数静态单测仍链接 manifest 固定的
  alpha.5 dependency，不能把总数解释为 current runtime 覆盖。见
  [V5.231](evidence/v5-231-session-v3-direct-turn-attestation-2026-09-11.zh.md)。这仍不能外推为 EvoForge supported；
  resolver persistence、retry/replacement/compaction/PTC、pin 与完整矩阵仍需成组迁移。
- 已审计 alpha.5 支持组合的全量检查和套件合同见 [V5.221](evidence/v5-221-latest-dsh-full-check-2026-09-04.zh.md)。
- 单页控制台历史复验见 [V5.196](evidence/v5-196-single-page-control-center-live-revalidation-2026-09-04.zh.md)；
  该证据不覆盖当前浏览器 profile。
- 本地 pairing assembled 回归见 [V5.223](evidence/v5-223-local-pairing-assembled-regression-2026-09-04.zh.md)。
- Hermes 当前冻结切片入口见 [V5.224](evidence/v5-224-current-hermes-benchmark-suite-2026-09-04.zh.md)。
- 默认 `product` 安装、卸载、全仓测试和文档收敛见
  [V5.228](evidence/v5-228-product-install-and-document-reset-2026-09-05.zh.md)。

## 当前环境注意事项

最近一次运行态探测发现：当前用户 profile 的部分 DSH fallback 文件归属导致 CLI 出现 EACCES；裸 Web 端口没有
认证 cookie 会返回 401，必须使用启动日志中带 token 的完整 URL；空白/未绑定 Session 也不会显示
conversation.view。安装器只能报告这些阻断并提供可恢复方案，不得自动 chown、删除用户文件或创建第二网页。

## 下一退出门

1. 当前 head Web：clean profile 热 reload/dispose、带认证 URL 的单 Host/单页面和真实 Session readback；
2. 真实 Feishu/Telegram：配对、回复、重启新消息、Approval/Schedule/group、撤销、uncertain 和长期重连；
3. Provider 验收：先在新 epoch 补齐可执行代码、运行时 artifact、配置绑定、终态 revision 和私有输出 attestation，
   再以两套独立 Provider 验证未见样本、负迁移/遗忘、误晋升、成本/时延/cache-read 和精确回滚；
4. 同任务/模型/权限/预算 Hermes paired：每个声明工作流 verified，至少一个核心指标 better；
5. registry 命名空间、可恢复安装器、release gates 全部通过后才创建首个 annotated tag。

普通 native `skill` error 可能来自 policy、加载、取消或执行错误，不能证明 Skill 缺失；对应 monitor 已撤下，历史
`native-skill-miss` 行只保留可读性且不得进入 opportunity/evaluation。当前只允许自有 `report_capability_gap` 的 exact
schema/body/final result/completed-turn 链形成 raw-free Routing receipt；model-declared Gap 也必须经同一 completed turn 的
durable qualification 才能进入旧 authoring loop。下一增量仍需迁移 current handle-based resolver persistence、
retry/replacement/compaction/PTC 与依赖/Case Pack pin，再把完整、可重放的 Interaction Episode 接入 opportunity/evaluation；
在此之前完整自我进化闭环仍是 partial。
