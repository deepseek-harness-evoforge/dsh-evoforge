# V4-17 Candidate 生成前独立评测证据密封

日期：2026-08-19
状态：implemented，尚不是完整自主评测闭环

## 本增量证明什么

- 两个不同 Goal 仍只形成 `Skill Opportunity`；少于四个不同 Goal 时，slow loop 保留 Opportunity，但在预算预留和模型调用前 abstain，不生成 Candidate。
- 达到四个或更多 Goal 后，`SkillEvaluationEvidenceVault` 从 exact Workspace/Skill/Opportunity/Gap 快照确定性选择最多 12 个 Goal，并在 Candidate author 调用前形成内容寻址 `Skill Evaluation Evidence Seal`。
- seal 至少含两个 authoring、一个 admission 和一个 holdout 样本。author 接口只返回 authoring Goal/Gap 子集、seal id 和 author-input digest；admission/holdout objective 不进入 proposer 请求。
- seal 使用治理根下的 exact real path、私有文件权限和原子目录安装；快照漂移、重复 Gap、symlink、内容篡改、路径/identity 不一致均 fail closed。
- 生成侧在写盘前执行与读取侧相同的 256 KiB manifest 上限；超限 Opportunity 不创建治理目录，也不会进入预算或作者调用。
- Evaluation Envelope 升级为 v3，并重新核对 seal id、Candidate author-input digest 和完整 Opportunity 快照；不能事后为任意 Candidate 拼装另一套治理包。
- DSH Web 的 Host 权威 Opportunity 投影区分 `waiting`、`unavailable`、`invalid`、`ready-to-seal` 和 `sealed`，并只显示样本数量和短 evidence id。凡进入该 Opportunity 的 Gap，浏览器投影一律移除 Goal objective；Session、消息正文和 holdout 内容也不返回，且不新增模型调用。

## 已执行验证

- `pnpm exec vitest run test/skill-evaluation-evidence-vault.test.ts test/skill-evaluation-envelope.test.ts test/slow-loop-skill-authoring.test.ts --reporter=verbose`：3 files / 18 tests 通过，覆盖四 Goal 密封、两 Goal abstain、篡改失败关闭、author 子集、900 Goal 有界输入、Envelope/author digest 绑定、取消与 uncertain 恢复。
- `pnpm exec vitest run test/skill-candidate-evaluation-flow.test.ts --reporter=verbose`：1/1 通过，证明同一 v3 Envelope 从 deterministic admission 进入 assembled holdout handoff。
- `pnpm exec vitest run test/evolution-control-plane.test.ts --reporter=verbose`：7/7 通过，证明 browser-safe readiness 来自 Host control plane。
- `pnpm exec vitest run test/evolution-action.client.test.tsx --reporter=verbose`：24/24 通过，证明 Web 能解释“2/4 等待”且没有 Candidate/安装动作。
- package declaration contract 验证 packed `dsh-evolve` 不再携带已删除的 acquisition/research 模块声明；构建后会按 `src/*.ts` 权威集合清理孤儿 `.d.ts`/`.d.ts.map`，避免旧 API 从 tarball 继续冒充受支持能力。
- 使用最终 tarball 在全新 DSH profile 安装 `dsh-evolve` 与 `dsh-evolve-web`，由官方 Workspace/Session/Goal/Agent event 路径建立四个独立 Gap。真实浏览器看到 `4 个独立 Goal · 4 次缺口观测`、authoring/admission/holdout=`2/1/1`、`ready-to-seal`、零 Candidate、零安装/激活/发布动作，且演化面板不含测试 Goal objective。
- 同一浏览器中在线刷新无错误；中断 Host 后刷新明确显示 `Failed to fetch` 并保留最后可信快照；以同一 profile、同一端口重启后，错误消失、四 Goal Opportunity 和零 Candidate 状态恢复，console error 为 0。
- 浏览器 fixture 的实现过程先后暴露并修正了 Loader 同步等待死锁、测试模块错误解析 Agent 入口、单 Session 连续 Goal 只保留一个当前 Gap、空 admission 目录误报无效证据四个问题；最终证据只记录修正后的 clean-profile 结果，不把中间失败当作通过。
- 根级 `pnpm check` 通过：文档链接/公开路径、全仓 typecheck、全部 11 个插件包测试和全包 build 均退出 0；加入写前 manifest 上限反例后的最终 `dsh-evolve` 复验为 60 passed files / 1 skipped，290 passed tests / 2 skipped。
- `pnpm test:cache-contract` 全通过：64-turn Gap Tool 稳定、GitHub Review composition、Goal cold-resume、assembled delivery、飞书完整渠道 composition 与 Doctor 原生插件合同 22/22。
- 十一包 `clean-profile-suite.e2e` 以最终源码复验 1/1 通过（29.78 秒）：最终 tarball add/dump/boot、原生 Session/Goal/Storage/Tool、dispose、remove、再次 boot/readback；独立 `dsh-doctor` packed add/Loader/command/remove 生命周期 1/1 通过（4.08 秒）。

## 明确未证明

本证据完成时，seal 只解决“Candidate 作者不能看到用于 admission/holdout 的内部 Goal 样本”和“评测包不能事后脱离作者输入”两个治理断点，Envelope 目录仍需治理侧提供 Case Pack。后续 [V4.18](v4-18-autonomous-governance-envelope.zh.md) 已实现 Candidate-independent 治理作者、零 proposer 校准、Envelope v4 原子安装和 uncertain restart 门；但真实 provider paired Trial、长期 transfer/negative-transfer、exact 飞书消息、Hermes 同条件 benchmark 和发布 tag 仍未完成。
