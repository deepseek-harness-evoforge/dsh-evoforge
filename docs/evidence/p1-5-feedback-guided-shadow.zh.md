# P1.5 证据：反馈引导、独立评测的 Shadow

> 日期：2026-08-16  
> 声明等级：`implemented`；闭合已有可信 Case Pack 覆盖范围内的 feedback → Candidate → Trial，
> 不代表任意新反馈都能自动生成 evaluator 或安全晋升

## 用户结果

用户可以把 P1.4 的私有草稿显式交给一次离线 Shadow：

```text
dsh-evolve shadow <skill-dir> \
  --case-pack <trusted-case-pack-dir> \
  --feedback-draft <private-draft.json> \
  --output <run-dir>
```

本次 proposer 会同时看到 active Skill、Case Pack 的公开 search evidence，以及该条直接用户请求和
correction。草稿被标为“不可信搜索证据”，不会进入 hidden final-test；候选只有在既有 evaluator
先通过 known-bad/known-correction 校准、baseline 失败且 Candidate 通过时才得到 promote 建议。
active Skill 和当前 Session 始终不变。

## Test-first 行为证据

macOS CLI 验收先以未知 `--feedback-draft` 参数转红，最小实现转绿后证明：

- 内容寻址且 `0600` 的草稿通过严格 Schema、id、目标 Skill 与 whole-Skill content hash 验证；
- proposer 收到用户文本、correction 和 untrusted 标签，但收不到 final-test sentinel；
- 真实四次 Sealed Trial 得到 baseline fail / Candidate pass / promote；
- 框架不把草稿输入字段直接复制到 report、run journal 或 proposal evidence；固定 proposer 未回显
  的验收中，持久证据只出现草稿 id/恢复路径，不出现用户文本或 correction；
- 同 id 内容篡改、权限过宽、符号链接、目标 Skill 或 content hash 漂移均在模型请求前拒绝；
- durable state 保存 exact 草稿路径，resident supervisor 恢复时转交同一路径；已有 Candidate 的
  Trial 恢复不重复付费 proposer 请求；
- macOS 固定 DSH assembled 选集显式包含该 CLI 验收，并继续覆盖 sealed Trial、native Jobs、
  crash recovery、Generation 和安装/卸载。

功能提交为 `25dd770694c355863a48aab8d82ae5dfd2fe91bf`。本地完整 `pnpm check` 在文档提交前通过：`dsh-evolve` 109 passed /
2 skipped，`dsh-software-delivery` 24 passed / 1 skipped，合计 133 passed / 3 skipped；docs、
typecheck 与两个包 build 同时通过。macOS assembled 选集为 55/55。

该精确功能提交的公开 [CI run 31950123419](https://github.com/deepseek-harness-evoforge/dsh-evoforge/actions/runs/31950123419)
全部通过：Node 22.19.0 约 42 秒、Node 24 约 31 秒、macOS 固定 DSH assembled lane 约 2 分 23 秒。
CI 同时验证两个发布 tarball 只包含声明的 dist、README、LICENSE 与 package manifest。

## Cache、token、隐私与授权

- 正常 DSH Session 仍增加 0 个 Tool、0 个 system-prompt 片段、0 个 provider，额外 token 为 0；
- 只有显式 Shadow proposer 增加草稿正文。上限为 12 KiB UTF-8，粗略最坏约 3,072 input tokens，
  且与 Skill/search evidence 共用 Case Pack 的 `inputTokenLimit` hard gate；
- 显式 CLI 调用是本次付费请求与反馈外发授权。草稿创建本身、后台 intake、自动 canary 和恢复不会
  静默发起新的 proposer 请求；
- 用户文本/correction 不作为独立输入字段进入长期 Shadow evidence；但 proposer 若在 claim 或
  Candidate 中回显/转述，模型输出会因 crash-resume 而持久化，调用者必须按此风险选择草稿；
- Case Pack 是独立真相来源。该 slice 没有生成 evaluator、没有改变自动晋升 allowlist，也没有扩大
  merge、release、部署、秘密或不可逆动作权限。

设计取舍见 [ADR-0019](../adr/0019-feedback-guides-search-not-evaluation.md)。
