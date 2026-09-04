# V5.224：当前 DSH 版本的 Hermes paired slice 聚合入口（本轮）

## 发现的问题

最新 canonical DSH 已更新到 `d347e703908d0406b7a7ef80e3a0e594d86b2215`，而历史 `pnpm benchmark:hermes` 仍硬编码 epoch-1 的 DSH `47f9438…`。在当前工作树直接运行该命令会按设计 fail closed：runner 报告实际 revision 与冻结 manifest 不一致；没有把新结果写回旧 epoch。

## 修正

保留历史 `benchmark:hermes` 入口和 epoch-1 manifest/result 不变；为 SD-1、LC-1、AS-1 runner 增加显式 manifest/result 环境变量和 `ALLOW_NEW_EPOCH` 冻结流程，并新增当前 DSH alpha.5 支持组合的独立 epoch-2 manifest/result。新增入口：

```text
pnpm benchmark:hermes:current
```

运行前必须显式提供已审计、可构建的 DSH 支持 checkout：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/audited-dsh-support \
EVOFORGE_HERMES_SOURCE_DIR=/absolute/path/to/hermes-at-29d0cc2 \
pnpm benchmark:hermes:current
```

## 结果

本轮使用 DSH `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`、Hermes `29d0cc2602e01943ab300c0382fc9d97efb376da` 严格复跑四项：

- EV-1 epoch-4：校准 `2/2`，EvoForge active Skill 提前修改 `0`、Hermes `1`；候选隔离、Session pin、回滚/重启门通过。
- SD-1 epoch-2：通过检查双方 complete；失败检查 EvoForge 保持 active、Hermes 接受 complete，主指标 `0` 对 `1`。
- LC-1 epoch-2：双方均在一次 `SIGKILL` 后保留权威工作单元，恢复动作 `1`，重复恢复 `0`，结果为 tie。
- AS-1 epoch-2：双方均拒绝错误用户和重复回调、只解析一次 allow-once，主指标 `0` 对 `0`，结果为 tie。

## 边界

这些仍是无网络、确定性 fixture paired slices，不是模型质量、真实 Feishu/Telegram、真实 Provider、长期迁移或整体 Hermes 上位替代证明。真实渠道、Provider、长期效果、npm ownership 和发布 tag 门禁保持原状态。

