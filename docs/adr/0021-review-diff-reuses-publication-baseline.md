# ADR-0021：Review Diff 复用发布基线，不复制新的内容证据

## 状态

Accepted，2026-08-16。

## 背景

P0C.2 的 `/evolve review <id>` 已展示 claim、文件名、Case、成本、理由和限制，但人工仍要去
别处回答“具体改了什么”。Shadow journal 保存完整 Candidate proposal 和基线内容 hash，却没有
保存基线内容；`resumeInputs.skillDir` 可能在运行结束后漂移，不能用于构造可信 diff。为了展示
diff 再复制一份基线 Skill 或完整 patch 到 run evidence，也会扩大私有指令和反馈回显的持久化面。

发布路径已经有正确的权威关系：当前 Capability Generation（或 native Git HEAD）解析出 exact
Git Skill artifact，whole-tree hash 必须等于 Shadow 的 `baseTreeHash`，proposal 重建出的完整树
必须等于 sealed `candidateTreeHash`。Review 和 publish 应共享这条验证实现，不能各自猜基线。

## 决策

`CandidatePublisher` 深化为同一 Candidate 的验证、预览和发布模块。`preview(candidate)`：

1. 从当前 release selection 和 `GitSkillSource` 解析发布会使用的不可变 Git baseline；
2. 校验 baseline whole-tree hash；
3. 在私有临时目录重建 Candidate，并校验 sealed Candidate whole-tree hash；
4. 运行本机、无网络、禁用 color/external diff 的 Git no-index diff；
5. 把控制字符转成可见的 `\xNN` / `\uNNNN`，最多返回 16 KiB UTF-8 前缀，并报告
   `shownBytes`、`totalBytes` 和 `truncated`。

`/evolve review <id>` 在 host-only Commands surface 显示这个结果。它不调用模型、不写 Git object
或 Generation、不改变 branch/worktree/active pointer，也不把 diff 写回 Shadow evidence。路径漂移、
Git 缺失、baseline 不匹配或 Candidate 无法重建时失败关闭；不会退回读取 mutable `skillDir`。

## 结果

- 人工在一次 review 中可同时看到“改了什么、为何通过、成本和限制”；
- preview 与 publish 共享 exact baseline 和 Candidate materialization，避免两套安全判断漂移；
- 大 Candidate 不会把 host command 变成无界输出，截断也不会被误称为完整 diff；
- 未信任 Candidate 不能用 ANSI、C0/C1 或双向控制字符伪造 review 终端显示；
- 不新增 Web/TUI、Control Center、模型 Tool、Prompt、Schema、daemon 或持久状态；正常 Session 的
  KV Cache surface 与 token 成本保持不变；
- 这仍是命令行 preview，不提供分页、折叠或真实用户可用性证据。若未来至少两个 UI adapter
  需要同一投影，再提取独立 Control Center seam。
