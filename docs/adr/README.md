# 架构决策记录

这里仅保留仍约束当前实现的架构决策。已被取代的 Goal-only、独立 CLI、静态 target、Git Candidate 和重复实现
决策已从工作树删除；Git 历史是它们的档案，不再让旧文件与当前规范并列。

## 当前决策

- [ADR-0104：会话优先、Goal 可选的运行时与进化](0104-conversation-first-runtime-and-goal-optional-evolution.md)
- [ADR-0041：DSH 是唯一运行时和安装面](0041-dsh-is-the-only-runtime-and-install-surface.md)
- [ADR-0047：main 开发线与验证 tag](0047-main-is-the-live-development-line-and-tags-mark-verified-releases.md)
- [ADR-0049：一个原生 DSH Gateway](0049-channel-adapters-share-one-thin-dsh-gateway.md)
- [ADR-0050：内部 Candidate 取代运行时能力获取](0050-internal-candidates-replace-runtime-skill-acquisition.md)
- [ADR-0069：渠道附件只进入 DSH 原生附件边界](0069-channel-images-enter-dsh-as-native-attachments.md)
- [ADR-0089：飞书审批绑定 exact card/route](0089-feishu-approval-actions-bind-the-exact-card-and-route.md)
- [ADR-0090：飞书内容读取走原生工具](0090-feishu-content-reads-are-agent-scoped-native-tools.md)
- [ADR-0091：飞书内容 readiness 由 Host 权威](0091-feishu-content-readiness-is-host-authoritative.md)
- [ADR-0098：配对由常驻 Gateway 持有](0098-channel-pairing-is-a-resident-gateway-host-authority.md)
- [ADR-0099：一个原生 Control Center view](0099-control-center-owns-one-native-view-and-child-surface-slot.md)
- [ADR-0100：套件不跨越运行时边界](0100-capability-suites-preserve-runtime-boundaries.md)
- [ADR-0101：registry 命名空间先于发布](0101-public-package-namespace-before-npm-release.md)
- [ADR-0103：Adapter 使用 DSH CredentialProvider](0103-channel-adapters-use-native-dsh-credentials.md)

新增决策前先判断能否修订当前 ADR；不要为每个测试增量新建一份架构决定。过程与命令写 evidence，当前行为写
requirements/architecture，用户行为写 README。
