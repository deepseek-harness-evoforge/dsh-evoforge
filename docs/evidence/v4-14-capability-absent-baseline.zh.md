# V4-14 Capability-Absent Baseline 证据

> 声明等级：`implemented`，不是 `released`。本文证明内部缺失 Skill Candidate 能与“未安装该 Skill 的原始
> DSH”进行 paired Trial 和 assembled Shadow；不证明 Evaluation Envelope 已自主生成、新 Skill 已晋升、
> Retention 已完成或 Hermes paired benchmark 已达标。

## 修正的错误前提

内部 Opportunity 的资格来自完整原生 catalog 对 exact Skill 的缺失确认。旧 Envelope 却要求一个带
`SKILL.md` 的 baseline 目录，Shadow/evaluator 又无条件把它安装进 DSH。这会用人为占位 Skill 替代真实缺失
能力。v2 Envelope 将 baseline 明确定义为 `capability-absent`：只允许绑定 Opportunity 的 `subject.json`，
禁止放入 `SKILL.md`。

```text
same DSH revision / driver / evaluator / budget

baseline                              candidate
DSH profile                           DSH profile
└─ target Skill absent                └─ exact quarantined whole-Skill installed
   → real Goal path fails                → same Goal path passes

non-target composition fingerprint must remain equal
```

## 实现与安全边界

- Trial subject protocol 显式传递 `skill-tree | capability-absent` 和 exact Skill 名；
- evaluator 必须声明 `capabilityAbsentBaseline: true`，否则拒绝；
- absent subject 中出现 `SKILL.md` 会在 Trial 和 Envelope 两层拒绝；
- Envelope v2 绑定 Workspace、Opportunity、Gap 快照、absent descriptor hash、admission 与独立 holdout；
- Admission 和 assembled Shadow 使用同一 baseline kind，Candidate 只以 exact tree 执行；
- Shadow durable identity/resume inputs 记录 baseline kind、缺失 Skill 和 exact Candidate 路径；resident
  supervisor 崩溃恢复时重建 exact Candidate，而不退回 proposer；
- Shadow report/Review projection 明示 `capability-absent`，允许差异仅为 `skill.presence` 与 `skill.body`；
- 当前 Session、catalog、治理目录和 Candidate 原件在 Trial 前后保持不变。

## 自动化与真实 DSH 证据

`capability-absent-baseline.e2e.test.ts` 使用固定 DSH revision `47f943859bef60e4160492346772ded9b24f765a`、
真实 Loader、Agent Loop、按需 Skill 与 Tool round-trip：

- calibration 的 known-bad/known-correction 方向通过；
- baseline profile 没有目标 `SKILL.md`，结果 fail；
- Candidate profile 只安装 exact whole-Skill，结果 pass；
- baseline/Candidate 的非目标 composition fingerprint 相同；
- 完整 `runShadow` 产出 `promote` recommendation、absent parent kind、全包 changed files 和 Review Candidate；
- crash supervisor 单测证明恢复时携带 absent identity 和 exact Candidate，不重新调用 proposer。

根级 `pnpm check` 通过；其中 `dsh-evolve` 为 58 files passed、1 file skipped，273 tests passed、2 skipped。
Cache Contract 全通过，Doctor 原生插件合同 22/22；十一包 clean-profile tarball add/dump/boot、真实
Session/Goal/Tool、dispose/remove/reboot/readback 1/1，通过时间 25.96 秒。

## 未完成边界

Envelope 仍由治理目录预先提供，尚未从内部 Goal/纠正/outcome 自主构造未见 admission/holdout。现有
Git-backed Publisher、Retention 与 canary 假设目标 Skill 已存在并配置 Git source，不能安全发布新 Skill；
该路径必须重构为内容寻址的 whole-Skill 新能力发布与未来 Session Generation，再完成真实 Retention、
负迁移、回滚、provider outcome、飞书闭环和 Hermes paired benchmark。未完成前不得自动晋升或打 tag。
