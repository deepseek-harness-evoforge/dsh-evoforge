# V5.123：Hermes EV-1 当前 alpha.5 revision 新冻结 epoch

## 结果

为避免继续引用已过时的 DSH `47f9438` 结果，本轮在当前可构建支持基线 DSH alpha.5
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` 上建立独立 manifest/result，不改写 epoch-1。Hermes 对照固定为
本地审计 revision `29d0cc2602e01943ab300c0382fc9d97efb376da`，两侧使用同一冻结 Skill 修正、同一无网络
Seatbelt evaluator 和同一冻结试验配置。

新 epoch `ev1-skill-correction-control-plane-epoch-2-alpha5` 实际运行通过：

- 已知坏样本 `fail`、已知修正样本 `pass`，校准 `2/2`；
- EvoForge baseline 在评测期间字节不变，显式晋升前不改活动 Skill（指标 `0`）；
- Hermes 直接修改活动 Skill 后再评测（指标 `1`）；
- EvoForge 当前 Session 保持旧 Generation，未来 Session 才采用 Candidate；跨 Workspace 激活 fail closed；
- 回滚与重启保持精确权威状态；Hermes 不具备这些隔离门。

## 验证命令与结果

在 canonical DSH 最新 `origin/master` fetch/clean preflight 后执行：

```text
pnpm --filter dsh-evolve exec tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck --allowImportingTsExtensions --types node ../../benchmarks/hermes-v0.1/ev1-control-plane/run.ts
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d \
EVOFORGE_HERMES_EV1_MANIFEST=benchmarks/hermes-v0.1/ev1-control-plane/manifest-alpha5.json \
EVOFORGE_HERMES_EV1_ALLOW_NEW_EPOCH=1 \
pnpm --filter dsh-evolve exec tsx ../../benchmarks/hermes-v0.1/ev1-control-plane/run.ts
```

首次 `ALLOW_NEW_EPOCH=1` 运行产出 `result-alpha5.json`；随后以同一 manifest/result 去掉该开关严格重跑，
输出仍为 `0/1` 且结果完全匹配冻结文件。runner 的自定义 manifest/result 路径统一相对仓库根解析，避免
pnpm filter 改变 cwd 后不可复现。

## 边界

这是确定性 Skill 发布控制对照，不调用模型、不读取凭据、不产生外部副作用，也不证明真实模型质量、渠道可靠性、
长期负迁移或整体 Hermes 上位替代。真实 Provider、Feishu AS-2、Telegram 外部通路、完整 paired benchmark 和
长期效果仍由 `release-gates.json` 单独阻断；旧 epoch-1 结果保持不可变。
