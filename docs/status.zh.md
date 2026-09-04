# 当前状态

更新时间：2026-09-05。本文只保留当前结论和阻断；逐次命令与历史结果见 [evidence 索引](evidence/README.zh.md)。
状态词的含义见 [Hermes 对照记分卡](architecture/hermes-replacement-scorecard.zh.md)。

## 总结

项目仍是 pre-alpha。插件代码、Cordis 生命周期、套件打包和一部分 assembled 测试可复现；真实渠道、真实 Provider、
长期进化效果和同条件 Hermes paired 还没有形成发布证据。因此当前不能宣称“整体 Hermes 上位替代”，也没有稳定
npm registry 包或 SemVer release tag。

## 当前矩阵

| 范围 | 当前结论 | 状态 |
| --- | --- | --- |
| DSH 兼容 | canonical latest 为 d347e703908d0406b7a7ef80e3a0e594d86b2215 / 0.1.3-alpha.1；安装通过，但上游 dsh-root 类型入口阻断根构建；可构建支持组合仍为 alpha.5 | blocked upstream |
| 安装 | 默认 `product` 套件、一行仓库安装、exact manifest/SHA、持久内容地址、禁用依赖 install script 和配置输出保护已有合同 | clean-profile add/dump/boot/remove/reboot verified；registry 与当前 head reload/browser 未完成 |
| 插件契约 | 官方 Bundle/profile patch、生命周期、独立启停/卸载和套件打包有本地合同 | implemented / local verified |
| Gateway | Host 内常驻、pairing、路由、journal、幂等、uncertain、dispose 竞态有 assembled 证据 | verified locally; real soak pending |
| Feishu | 已有原生凭据/Adapter、配对和局部 direct-DM smoke；完整 AS-2（重启新消息、Approval/Schedule/group、撤销、长期重连）未齐 | partial |
| Telegram | Adapter、pairing assembled 和安全合同存在；真实 Bot AS-1 尚未完成 | partial |
| Evolution | Interaction-first 设计已冻结；无 Goal Gap signal 已持久化并返回 `abstained`；Candidate/隔离评测/future-Session pointer/canary/rollback 有本地合同 | partial；legacy opportunity/evaluation 仍只消费 Goal-linked evidence，普通 Interaction 尚未贯通慢环，因此不能宣称自我进化闭环已完成 |
| Web | 一个 Session-scoped native conversation.view 和 child slots 有局部浏览器证据；blank Session/onboarding 不渲染 slot，当前 profile 仍需 clean recheck | partial |
| Delivery/continuity | 公开 delivery 只含隔离交付；github-review 因 CredentialProvider 迁移未完成而阻断；Goal 冷恢复、Resident 协议有本地测试 | partial; real soak pending |
| Hermes paired | EV-1/SD-1/LC-1/AS-1 为冻结 deterministic/assembled slices，不等于模型质量或整体替代 | not-measured for full claim |
| Registry/release | 未发布 registry 包；没有通过所有 required gates 的 annotated tag | blocked |

## 最近可复核事实

- DSH latest audit（2026-09-05）：安装退出码 0，根构建退出码 1，分类为上游 dsh-root 缺失类型入口；见
  [最新审计摘要](research/dsh-latest-audit-2026-09-05.zh.md)。[V5.218](evidence/v5-218-latest-dsh-build-reaudit-2026-09-04.zh.md)
  是前一日的不可覆盖历史 evidence。
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
3. 两套独立 Provider：未见样本、负迁移/遗忘、误晋升、成本/时延/cache-read 和精确回滚；
4. 同任务/模型/权限/预算 Hermes paired：每个声明工作流 verified，至少一个核心指标 better；
5. registry 命名空间、可恢复安装器、release gates 全部通过后才创建首个 annotated tag。

当前 Gap tool 和 native Skill miss monitor 已完成“无 Goal 的普通 Interaction → durable signal → 可解释 abstain”过渡合同，
并有 4 个文件 / 27 个测试与 typecheck 证据；它们不会触发旧的 Goal-linked authoring。下一代码增量应把独立、可重放的
Interaction episode 接入 opportunity/evaluation 门，再逐步替换按 Goal 数量计数的旧 epoch；在此之前，Goal-optional 设计
是入口基线，完整自我进化闭环仍是 partial。
