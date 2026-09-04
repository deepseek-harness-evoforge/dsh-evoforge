# 参考生态最新 revision 审计（2026-09-05）

本页是本轮设计前对 Hermes、Hermes Self-Evolution、OpenClaw 和 HanaAgent 远端公开仓库的重新核对。它只记录源码身份和设计参照，不把任何外部项目变成 EvoForge 的运行时依赖，也不把参考项目的计划当成已验证能力。

## 复核命令

在 2026-09-05 执行：

```sh
git ls-remote <公开仓库> HEAD
```

结果是远端 `HEAD` 的不可变 commit；没有凭据、私有内容或本地修改参与复核。

| 对象 | 公开仓库 | 远端 HEAD | 本轮用途 |
| --- | --- | --- | --- |
| Hermes Agent | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | `13e72fb205b735df679e0fd5f5996a34ac4accc6` | Gateway、pairing、Session 路由、Skill/Memory 闭环和 paired benchmark 参照 |
| Hermes Self-Evolution | [NousResearch/hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution) | `0a929e3aa20e15cf04dc7c28492a7d41a5139125` | GEPA/候选数据集/holdout 研究参照；仓库自身仍是独立实验项目 |
| OpenClaw | [openclaw/openclaw](https://github.com/openclaw/openclaw) | `9f1c8a1c58bd1e889df4f7e78742ade56d7efefe` | reviewer、隔离候选、控制面和渠道边界参照 |
| HanaAgent | [liliMozi/openhanako](https://github.com/liliMozi/openhanako) | `1d3ef308299e9f630786384e77de45444ea59196` | Page/Widget 信息层级、权限和插件体验参照 |

## 采用与明确不采用

1. 采用行为目标：常驻 Gateway、陌生私聊 pairing、持久投递、候选隔离、未见样本和可解释控制面。
2. 不复制运行时：DSH 仍是唯一 Host、Session、Goal、Skill、Approval、Jobs、Storage 和 Web 权威；不引入第二 Agent Runtime、第二 Gateway、外部 Skill 市场或另一套审批。
3. 不把“模型写出了 SKILL.md”称为进化。EvoForge 必须用真实 Interaction 信号、独立 baseline/holdout、权限/成本/cache 门禁、未来 Session pin、原子晋升和精确回滚证明改进。
4. 以上 revision 只服务于研究和 benchmark 身份。任何新 paired run 必须在运行前重新读取远端 HEAD，并在 evidence 中记录日期、命令和结果。

当前 DSH 自身的 revision、构建结果和支持决策见 [DSH 最新版本审计](dsh-latest-audit-2026-09-05.zh.md)；当前产品边界见 [产品设计基线](../architecture/product-target-and-design.zh.md)。
