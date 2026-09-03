# V5.128：alpha.5 EV-1 复现入口显式化

## 变更

当前可构建 DSH alpha.5 的 EV-1 epoch-2 已有独立 `manifest-alpha5.json` 与 `result-alpha5.json`，但此前只能
手工设置两个环境变量调用 runner。新增 package script：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/dsh-v0.1.2-alpha.5 pnpm benchmark:hermes:ev1:alpha5
```

脚本固定注入当前 manifest/result；历史 `pnpm benchmark:hermes:ev1` 与 epoch-1 保持不变。runner 仍核对
Hermes/DSH exact revision，任何结果漂移都要求新 epoch，不能覆盖冻结文件。

## 验证

在 canonical DSH 最新 `origin/master` fetch/clean preflight 后，使用已审计 alpha.5 支持 checkout 执行：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=<alpha5-support-checkout> pnpm benchmark:hermes:ev1:alpha5
```

输出与 `result-alpha5.json` 完全一致（校准 `2/2`、主指标 EvoForge `0` / Hermes `1`）。该结果仍只支持
确定性 Skill 发布控制面的窄结论，不支持模型质量、真实渠道或整体 Hermes 上位替代。
