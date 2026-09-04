# V5.159：当前 Hermes revision 的 EV-1 epoch-4

日期：2026-09-04  
EvoForge revision：`738ac68876c315d1bbb89a5a33f39d0ef769bd89`  
DSH assembled revision：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（alpha.5）  
Hermes revision：`29d0cc2602e01943ab300c0382fc9d97efb376da`（`origin/main`，clean）

## 先行审计与漂移修复

先对 Hermes 执行 `git fetch origin --tags --prune`，确认 `HEAD == origin/main`、工作树干净，当前 tag 描述为
`v2026.8.13-104-g29d0cc2602`。直接运行旧的 `benchmark:hermes:ev1:alpha5:current` 时，入口 revision assertion
发现 manifest 仍固定 `63279301…`，退出码 `1`；没有跳过 assertion，也没有把失败算作产品结果。旧 epoch-3 文件和证据保持不变。

## 新 epoch 命令

```text
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d \
EVOFORGE_HERMES_EV1_MANIFEST=benchmarks/hermes-v0.1/ev1-control-plane/manifest-alpha5-hermes-current-epoch4.json \
EVOFORGE_HERMES_EV1_ALLOW_NEW_EPOCH=1 \
pnpm --filter dsh-evolve exec tsx ../../benchmarks/hermes-v0.1/ev1-control-plane/run.ts
```

重跑实际输出已固定为 `result-alpha5-hermes-current-epoch4.json`。校准 `2/2`；EvoForge 与 Hermes 的冻结
baseline 都 `fail`、corrected 都 `pass`。EvoForge primary metric 为 `0`，Hermes 为 `1`。EvoForge 六项 hard gate
全部通过：baseline trial 内不可变、旧 Session 固定、未来 Session 使用 Candidate、跨 Workspace fail-closed、
rollback/restart exact；Hermes 仍在 active artifact 原地修改、无 Candidate boundary、无 Session generation pin。

## 结论边界

这是当前 Hermes revision 下的确定性 release-control 对照，不调用模型、不访问公网、不产生渠道副作用，也不代表
模型质量、真实 Hermes paired、真实 Feishu/Telegram、长期负迁移/遗忘或完整上位替代。因此 `hermes-paired` 发布门禁
仍为 `partial`，不能创建 release tag。详细 revision 漂移记录见 [当前复核](../research/hermes-current-revision-2026-09-04.zh.md)。
