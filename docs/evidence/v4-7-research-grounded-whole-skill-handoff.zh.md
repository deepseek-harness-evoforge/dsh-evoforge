# V4-7：研究驱动的 whole-Skill 慢环交接

> 历史证据：本页记录过往实现，不代表当前产品主链路或能力声明。运行时外部发现/研究方案已撤销；当前自我发现语义与实现见 [V4-8](v4-8-internal-skill-opportunity-discovery.zh.md)。

> 状态：`implemented`。本切片完成研究采集到隔离 Candidate 的纵向主链；后续独立 Holdout 与
> 一次性 revision 已分别在 `v4-7-independent-research-holdout.zh.md` 和
> `v4-7-one-shot-research-revision.zh.md` 完成。真实 provider 下的整链 Retention 仍未完成，因此不打 tag。

## 主链

慢环现在按以下确定状态运行：

`prepared → budget-deferred | research-pending → authoring-pending → candidate-ready`

任一步取消、研究不足、模型结果未知或 manifest 不合规都会落入持久状态，不会静默重试：

1. 先按 target 和 UTC 日预留统一 attempt 预算；Web 研究与模型生成共享这次 attempt，不产生隐藏的
   第二套预算。
2. `research-pending` 调用 DSH 原生 `ctx.web` seam。Jobs 与 Web 分别动态注入，无论谁先就绪，只有
   两者都存在才允许调度。
3. 完整 corpus 以 `0600` 写入运行目录的私有 `research.json`，包含 knowledge 与 verification；
   DSH Web 和作者模型都看不到原始 Goal 之外的私有宿主信息。
4. 模型输入只含 corpus digest 与 knowledge 数组，明确不包含 verification holdout。完整模型上下文
   上限 96 KiB，保留既有 48 KiB Goal 证据预算，没有用研究挤掉原有跨 Goal 需求证据。
5. 模型只能返回 `{ files }` manifest；Host 再次执行 canonical whole-Skill 组合校验，拒绝 scripts、
   深层或悬空 references、非规范文本和不匹配的 Skill identity。
6. 新 Candidate 使用 `slow-loop-research-bundle-v2`，版本血缘同时记录 model identity hash、Goal input
   digest、research digest、artifact digest 和 tree hash。产物仍为
   `quarantined / inactive / unevaluated / never executed`，无安装、激活或发布权。
7. 重启遇到 `research-pending` 会标记 incomplete；遇到已派发的 `authoring-pending` 会标记 uncertain。
   取消发生在模型派发前保持 0 次模型调用；派发后收到迟到响应也不会隔离 Candidate。

## DSH Web 可解释投影

Skills 页新增：

- `Native Web research in progress / 原生 Web 研究中` 阶段；
- 慢环运行的截断 research digest；
- `Research-grounded whole-Skill bundle v2 / 研究驱动完整 Skill 包 v2` 版本标签；
- Candidate 的 input、research、artifact、tree 四段摘要。

页面不投影 research excerpt、holdout URL、模型 route、Skill 正文或私有运行路径。

真实应用内 Browser 在 `?semantic` 产品 fixture 上验证：研究版本行可见，尺寸 `508 × 30`；控制面板
`560 × 632` 且 `scrollWidth === clientWidth === 560`；研究运行摘要唯一；Install/Activate 按钮为 0；
模型 identity、Skill 正文和 holdout URL 泄漏均为 false；页面 diagnostics 为 `[]`。视觉检查确认长血缘行
自然换行，慢环卡片与 Candidate 卡片层级清楚。

## 自动验证

- 目标测试：research boundary、slow-loop authoring、trusted discovery 共 29 项通过；
- `dsh-evolve`：55 files passed + 1 skipped；276 tests passed + 2 skipped；
- `dsh-evolve-web`：2 files / 25 tests passed；
- Typert 由锁定 DSH `47f943859bef60e4160492346772ded9b24f765a` 重新生成并通过 freshness gate；
- 根级完整门禁以本原子提交前最终执行结果为准。

## 后续状态

- verification anchors 已由
  [`v4-7-independent-research-holdout.zh.md`](v4-7-independent-research-holdout.zh.md) 的独立评估器消费；
- 失败/不确定的原始 v2 已能触发一次 bounded whole-Skill v3 revision；精确 parent tree、
  holdout result 和 research digest 进入谱系，v3 必须重新 Holdout 且不能再次修订；
- 尚未完成真实 provider 下的长期 Retention、真实飞书消息和同条件 Hermes paired run；
- 因此不打 tag，不宣称 Hermes 核心功能的上位替代已经完成。
