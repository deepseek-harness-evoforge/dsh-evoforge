# V4-7：Host 所有的 text-only whole-Skill 组合与隔离

> 状态：`implemented / in progress`；本切片只完成完整 Skill 包的供应链边界，不等于研究生成、
> holdout、Retention 或最终上位替代已经完成。

## 本次交付

本切片落实 [V4-7 研究约束](../research/v4-7-whole-skill-grounding-audit.zh.md) 的第一个可证伪纵切：

1. 模型侧未来只能提交结构化文本 manifest；Host 不接受模型提供的 base64 archive。
2. 首版只允许根 `SKILL.md` 与 1–31 个一层 `references/*.md`，最多 32 个文件、单文件
   64 KiB、总计 256 KiB。
3. 所有文本规范化为 canonical UTF-8/LF；拒绝 NUL、孤立 CR、非法 surrogate、重复/不安全路径、
   `scripts/`、深层 reference、缺失 reference、未引用文件和 reference-to-reference 本地链。
4. Host 固定文件 mode、owner、mtime、组件级路径顺序与 gzip level，得到字节级可复现的
   `tar.gz`、artifact digest 和 tree hash。输入顺序改变不改变归档字节或 Candidate id。
5. 新的 `slow-loop-author-bundle-v1` Candidate 始终是
   `quarantined / inactive / unevaluated / never-executed`；物化时全部文件写为 `0600`，不赋予
   安装、激活或发布权。
6. 物化前不仅复核 Candidate id、artifact digest、tree hash、Skill identity、许可证和包元数据，
   还会把解码文本重新交给 Host 组合器；只有重新生成出逐字节相同的 canonical archive 才可物化。
   测试证明即使只改 gzip OS header、同步重算摘要和 Candidate id，也会因非规范归档被拒绝。

## DSH Web 可解释投影

Skills 页新增独立来源版本标签“慢环完整 Skill 包 v1 / Slow-loop whole-Skill bundle v1”，并继续只显示：

- model input、artifact、tree 的截断摘要；
- `tar.gz` 分发形态、文件数、总字节与 references 标志；
- 跨 Goal 需求证据、bounded host authoring 来源；
- 隔离、inactive、never executed、unevaluated 与无发布权状态。

Web 投影不包含 archive、`SKILL.md`/reference 正文、模型 route 或宿主私有路径。

真实 in-app Browser 打开产品 `EvolutionAction` fixture 的 `?semantic` Skills 页后确认：whole-Skill
版本行唯一且具有 `504 × 26` 可见布局；面板 `560 × 632`，`scrollWidth === clientWidth === 558`；
Install/Activate 按钮 0，私有 model identity 0，Skill 正文 0，页面 diagnostics 为 `[]`。

## 验证

- `dsh-evolve`：54 files passed + 1 skipped；269 tests passed + 2 skipped；
- `dsh-evolve-web`：2 files / 25 tests passed；
- 两包 typecheck 与锁定 DSH `47f943859bef60e4160492346772ded9b24f765a` 生成的 Typert
  freshness gate 通过；
- `git diff --check` 通过；
- 根级 `pnpm check` 通过，覆盖文档、typecheck、tests、build、cache contract、生成契约和 Node artifact。

## 未完成

- 默认慢环 author 仍只产单文件 `SKILL.md`，尚未改为研究驱动的 whole-Skill manifest；
- DSH `ctx.web` 的有界 search/fetch、knowledge/verification anchor 分离与研究 lineage 尚未接入；
- 尚未实现基于新归因证据和 exact old tree 的有界 revision；
- 尚未完成真实 provider、飞书消息、独立 holdout、长期 Retention 与同条件 Hermes paired 验证；
- 因此不打 tag，不声明核心目标或“上位替代”完成。
