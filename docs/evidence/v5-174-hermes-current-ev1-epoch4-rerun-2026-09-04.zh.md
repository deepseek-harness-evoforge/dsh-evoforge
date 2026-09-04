# V5.174：当前 Hermes EV-1 epoch-4 确定性 paired 复跑

日期：2026-09-04  
EvoForge revision：`1cab62e`（运行时无改动，本证据随本轮文档提交）  
DSH support revision：`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`（alpha.5）  
Hermes revision：`29d0cc2602e01943ab300c0382fc9d97efb376da`（manifest 固定的 current main）

## 范围

本轮使用 `benchmarks/hermes-v0.1/ev1-control-plane/manifest-alpha5-hermes-current-epoch4.json` 与配套
expected result，重跑一条不调用模型、不访问网络、不读取凭据的 EV-1 确定性 Skill 修正控制面对照。两边使用
同一 known-bad / known-correction 校准输入；该实验只比较候选隔离、Session 代际固定、晋升和回滚边界，不比较
模型质量、渠道、成本或整体产品体验。

## 命令与结果

开发前重新确认 canonical DSH `HEAD == origin/master` 并使用已审计 alpha.5 support checkout；Hermes checkout
处于 manifest 要求的 exact revision。执行：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d \
EVOFORGE_HERMES_SOURCE_DIR=/absolute/path/to/hermes-at-29d0cc2602e01943ab300c0382fc9d97efb376da \
pnpm benchmark:hermes:ev1:alpha5:current
```

退出码 `0`。校准 `2/2`（known-bad=`fail`、known-correction=`pass`）。两边最终结果均为 baseline fail、corrected
pass，但控制面主指标不同：

| 指标 | EvoForge | Hermes |
| --- | ---: | ---: |
| final-test 前、显式晋升前原地修改 active Skill 的次数 | `0` | `1` |
| baseline 在 Trial 期间保持字节不变 | `true` | `false` |
| 当前 Session 跨晋升保持旧 Generation | `true` | `false` |
| Candidate 边界先于 mutation | `true` | `false` |
| 回滚与 restart 精确保持权威状态 | `true` | — |

runner 的最终 verdict 为 `better for deterministic Skill-correction release control`。

## 边界与后续门禁

该结果支持 EvoForge 在“候选不污染 active、当前 Session 不漂移、未来 Session 才启用”的窄控制面上优于当前
Hermes production seam；不支持 Hermes 核心功能整体上位替代、真实 Provider、真实渠道或长期负迁移/遗忘声明。
`release-gates.json` 中 `hermes-paired` 仍为 `partial`，因为同任务/同模型/同权限/同预算的真实 paired benchmark
以及长期效果数据仍未获得；本证据不能替代它们。
