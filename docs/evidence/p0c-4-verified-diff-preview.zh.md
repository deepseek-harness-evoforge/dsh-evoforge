# P0C.4 证据：Verified Bounded Diff Preview

> 日期：2026-08-16  
> 声明等级：`implemented`；这是 host-only 人工复核增强，不是 Web/TUI 或完整 Control Center

## 用户结果

`/evolve review <64-char-review-id>` 现在在既有 claim、Case、成本和限制旁直接展示：

```text
Verified diff (exact Git baseline → sealed Candidate; controls escaped; <bytes> bytes):
diff --git a/SKILL.md b/SKILL.md
...
```

若渲染 diff 超过 16 KiB，header 明确报告已显示/总字节数和 `truncated`，并提示发布仍会校验
完整 Candidate tree。用户不需要先批准或调用模型就能看清具体改动。

## 权威性与安全边界

- baseline 由发布路径相同的 current Generation/native Git source 解析，不读取可能漂移的
  `run-state.resumeInputs.skillDir`；
- baseline whole-tree hash 必须匹配 Shadow `baseTreeHash`；
- proposal 只在私有临时树应用，重建结果必须匹配 sealed `candidateTreeHash`；
- preview 不创建 Git ref/object、Generation 或处置，不移动 branch/worktree/active pointer；
- diff 不持久化为第二份内容 evidence，临时绝对路径不出现在输出；
- ANSI、C0/C1 和 Unicode bidi controls 以可见 escape 渲染；LF/Tab 保留；
- Git diff 禁用 color 和 external diff，整个路径无网络、无模型请求；
- 超过上限只展示 UTF-8 完整字符组成的精确前缀，不以截断内容代表完整 Candidate。

## 可复核测试

```bash
pnpm --filter dsh-evolve exec vitest run \
  test/candidate-publisher.test.ts \
  test/evolve-command.test.ts \
  test/generation-binder.e2e.test.ts

pnpm --filter dsh-evolve test
```

本纵切局部与固定 revision assembled DSH 覆盖 32 个测试；完整 `dsh-evolve` 为
116 passed / 2 skipped。assembled test 验证 review detail 含 exact diff、无临时根路径、
无额外模型请求，随后仍可发布 inactive Generation、显式 promote，并保持旧 Session 不漂移。

## KV Cache 与成本

- 新增模型 Tool、Prompt、Skill catalog 项：0；
- 正常 Session 新增 token：0；
- review detail 模型请求：0；
- 新增持久内容副本：0；
- host 输出上限：16 KiB UTF-8 rendered diff。

## 当前限制

- exact baseline 必须仍能由当前 release selection 和配置的 Git source 解析；选择已经漂移时
  fail closed，不能预览或批准旧 Candidate；
- 这是一次性 command 输出，没有分页、折叠、side-by-side 或浏览器交互；
- 真实用户能否快速、正确完成 review 仍需可用性试验，自动测试不能替代；
- Candidate proposal 本来就作为 crash-resume journal 内容持久化；本功能不减少该既有隐私面，
  也不新增 patch 副本。
