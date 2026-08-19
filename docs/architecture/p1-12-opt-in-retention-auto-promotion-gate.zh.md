# P1.12 Opt-in Retention Auto-Promotion Gate 契约

> 当前状态：**已撤销并待重建**。旧 Retention/自动晋升编排已删除；本页仅保留历史记录，当前边界见 [ADR-0068](../adr/0068-shadow-consumes-one-exact-internal-candidate.md)。

> 状态：implemented；首片只约束既有 clear-instruction 自动晋升

## 唯一用户结果

> 用户显式启用 Retention 门后，clear-win Candidate 只有在 exact 历史能力证据为 `retained` 时才能
> 自动晋升；`regressed`、`incomplete`、缺失或篡改证据都留在人工 review。

## 配置

```yaml
autoPromote:
  targets:
    - workspaceId: <workspace-uuid>
      skill: build-dsh-plugin
  retentionRoots:
    - /absolute/path/to/.dsh/evoforge/retention-runs
```

- roots 是 host-only static absolute paths，必须唯一，最多 20 个；
- 每个 root 的直接子目录是一次 P1.11 output；不递归猜路径；
- 省略/空数组代表不启用；授权只对 exact Workspace + Skill 生效；
- Web/Remote/Command 只显示状态与原因，不能提交 root/path。

## Evidence decision

对同一个 `ReviewCandidate`：

1. 只接受 regular、非 symlink 的 `retention-report.json`；
2. report schema/run id 必须可由 source run、Candidate、prior Pack 与 epoch 重算；
3. source run id、recommendation、Skill、baseline/Candidate hash 必须与 review exact 相等；
4. primary Pack、active Skill、prior Pack 必须报告 unchanged；
5. calibration 两项均 pass，prior baseline 必须 pass，composition 必须 stable，Trial ≥ 4；
6. proposer calls 必须为 0；comparison tree hash 必须与 subject 相等；
7. 匹配 `regressed` 时阻断优先；否则至少一个匹配 `retained` 才通过；只有 incomplete 或无报告均阻断；
8. malformed/tampered/duplicate-conflict 只产生 bounded host warning，不能被当作 retained。

## State flow

```text
Shadow review Candidate
  + existing P1.1 clear-win gates
  + optional RetentionEvidenceIndex
       missing/incomplete ──> pending human review
       regressed          ──> pending human review
       retained           ──> auto approve → inactive Generation → future-Session promote
```

如果崩溃发生在 auto approval 与 activation 之间，恢复必须再次执行完整 policy；不能仅凭旧
`review-state.json` 直接 promote。原有 exact publication、active pointer race 与 rollback 不变。

## KV Cache 与成本

- normal Session：模型调用与 token 增量为 0；模型可见 schema/composition 不变；
- policy scan：只读本地有界 report，不运行 evaluator，不调用 proposer/model；
- 不轮询外部服务；复用现有 supervisor scan；
- 不复制 Candidate、Case Pack、Prompt、反馈正文或 host path 到 Remote；
- 无 Mission、Memory、Case registry、workflow DAG 或第二个 daemon。

## 非目标

自动运行 Retention、多个 Pack 的 required/all/quorum 策略、Case 版本淘汰、人工 promotion hard gate、
Web 路径管理、通知中心、Linux/Windows sealed backend与真实 provider 效果均不进入 P1.12。
