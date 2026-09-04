# 文档导航

本仓库把“用户怎么用”和“维护者为什么这样实现”分开。先看根目录 README；只有需要配置、贡献或审计时才进入
下面的内部文档。

## 用户

- [README](../README.md)：产品介绍、快速安装、首次使用、飞书配对、Web 控制、升级、卸载和限制。
- [详细安装与配置](getting-started.zh.md)：本地 tarball 安装、profile、凭据、渠道和排障。
- [能力套件边界](capability-suites.zh.md)：普通用户只需要理解的安装结果。

## 设计与契约

- [产品目标与设计](architecture/product-target-and-design.zh.md)：整体边界、组件关系和用户旅程。
- [自我进化设计](architecture/evolution-design.zh.md)：会话优先的双速闭环、Candidate、评测和回滚。
- [Hermes 对照记分卡](architecture/hermes-replacement-scorecard.zh.md)：按工作流声明“已实现/已验证/更好”，
  不用一次窄测试宣称全量替代。
- [插件契约](plugin-contract.zh.md)：官方 Cordis/Bundle/Client 接缝和生命周期要求。
- [当前需求基线](requirements.zh.md)：维护者必须满足的产品约束。

## 研究、决定与证据

- [研究索引](research/README.zh.md)：DSH、Hermes、OpenClaw、HanaAgent 和前沿方法的一手资料。
- [ADR 索引](adr/README.md)：当前决策与历史记录的边界。
- [当前状态](status.zh.md)：短的当前快照和阻断项。
- [路线图](roadmap.zh.md)：维护者连续执行队列，不是用户选择菜单。
- [发布门](releasing.zh.md)：main、tag、clean-profile 和真实验收规则。
- [证据索引](evidence/README.zh.md)：历史/当前证据的范围、日期和可复核入口。

## 维护者夹具

- [examples/README](../examples/README.md)：内部 Case Pack 和 seed Skill；不是用户可安装示例。
- [benchmarks/README](../benchmarks/README.md)：Hermes paired、真实渠道和 Provider 验收 harness；不是插件。

历史增量证据只在 `docs/evidence/` 保留；仍被当前研究引用的源码快照必须在标题标明冻结 revision。重复、无引用或
已经错误的设计稿不留在工作树，需要追溯时使用 Git 历史。发现文档与实现矛盾时，先修正唯一权威页并删除重复稿，
不要再追加一份说明。
