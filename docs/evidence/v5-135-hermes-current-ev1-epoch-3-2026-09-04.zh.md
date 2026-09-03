# V5.135：当前 Hermes revision 的 EV-1 控制面 epoch-3

## 结果

本轮没有继续使用旧的 Hermes checkout。先审计并固定当前本地 Hermes `origin/main`
`63279301bcbdc185c1b07b98a9312eb0c862f26d`，再在已审计、可构建的 DSH alpha.5 支持基线
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` 上建立独立 epoch-3；epoch-1/2 的 manifest 与 result 均未改写。

严格复跑 `benchmark:hermes:ev1:alpha5:current` 通过：

- `known-bad` 为 `fail`、`known-correction` 为 `pass`，校准 `2/2`；
- EvoForge 的 baseline 在评测期间保持字节不变，显式晋升前不改 active Skill，主指标为 `0`；
- Hermes production `skill_manage` 在 final-test 前原地改写 active Skill，主指标为 `1`；
- EvoForge 当前 Session 仍固定旧 Generation，未来 Session 才使用 Candidate；跨 Workspace 激活 fail closed；
- 回滚与 Storage restart 保持精确权威状态。

## 固定输入与命令

manifest/result：

- `benchmarks/hermes-v0.1/ev1-control-plane/manifest-alpha5-hermes-current.json`
- `benchmarks/hermes-v0.1/ev1-control-plane/result-alpha5-hermes-current.json`

运行前先 fetch 最新 DSH 并确认 `HEAD == origin/master`、版本为 `0.1.2-rc.1`、工作树 clean；然后：

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/dsh-v0.1.2-alpha.5 \
EVOFORGE_HERMES_SOURCE_DIR=/absolute/path/to/hermes-at-63279301 \
pnpm benchmark:hermes:ev1:alpha5:current
```

runner 会再次核对 DSH/Hermes exact revision；manifest 或 result 漂移会 fail closed。

## 边界

这是同一确定性 Skill 修正输入上的发布控制面对照，不调用模型、不访问网络、不读取凭据，也不产生外部副作用。
它只支持 `DSH + EvoForge` 在“候选隔离、Session 稳定、晋升/回滚边界”这一窄场景优于当前 Hermes
production seam；不支持模型质量、真实渠道、真实 Provider、长期负迁移/遗忘、成本时延或整体上位替代声明。
完整 paired benchmark 与 release gates 仍必须独立通过。
