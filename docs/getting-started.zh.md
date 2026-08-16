# 开始参与 dsh-evoforge

## 1. 环境

- Node.js `^22.19.0 || >=24`
- pnpm `11.7.0`
- Git

克隆后运行：

```bash
pnpm install
pnpm check
pnpm test:pa1
```

`pnpm check` 依次执行 TypeScript 类型检查、全部测试和构建。生成目录 `dist/`、依赖目录和 `.evoforge/` 本地证据不会进入 Git。
`pnpm test:pa1` 额外把分散在 Evolve、Delivery 和 Web 的 Protected Action 行为收敛为一个
可执行 hard gate；macOS 才能完整执行 Seatbelt secret/network/host-read 隔离 case。

## 2. 当前包

```text
packages/dsh-evolve/
  src/          Shadow CLI、runtime 与权威控制模块
  test/         CLI/runtime/控制面行为测试
  README.md     包级行为和限制
packages/dsh-evolve-web/
  src/          DSH Host/Client Web Adapter
  test/         Remote、React 交互与 Bundle 契约测试
  README.md     安装、缓存和隐私边界
packages/dsh-software-delivery/
  src/          按需 Skill、Git 验证器与受验证完成动作
  test/         真实 Git、原生 Bash/Goal/Agent、打包安装/卸载测试
  README.md     安装、验证、权限和限制
packages/dsh-doctor/
  src/          Runtime Readiness 三态分类与原生 Command
  test/         Loader/Commands、Bundle dump、打包安装/卸载测试
  README.md     安装、三态语义、缓存和非目标
```

构建和检查单包：

```bash
pnpm --filter dsh-evolve typecheck
pnpm --filter dsh-evolve test
pnpm --filter dsh-evolve build
pnpm --filter dsh-evolve pack --pack-destination "$PWD/.evoforge/pack"

pnpm --filter dsh-evolve-web typecheck
pnpm --filter dsh-evolve-web test
pnpm --filter dsh-evolve-web build
pnpm --filter dsh-evolve-web pack --pack-destination "$PWD/.evoforge/pack"

pnpm --filter dsh-software-delivery typecheck
pnpm --filter dsh-software-delivery test
pnpm --filter dsh-software-delivery build
pnpm --filter dsh-software-delivery pack --pack-destination "$PWD/.evoforge/pack"

pnpm --filter dsh-doctor typecheck
pnpm --filter dsh-doctor test
pnpm --filter dsh-doctor build
pnpm --filter dsh-doctor pack --pack-destination "$PWD/.evoforge/pack"
```

### Runtime Readiness 装配

`dsh-doctor` 自带一个可删除 Bundle：

```bash
dsh plugin --profile web add dsh-doctor
```

默认只要求 Doctor 自身 active。若要检查完整 EvoForge composition，在 profile 的后置
`cordis.patch.yml` 中配置 exact module names：

```yaml
- id: evoforge-doctor
  config:
    requiredModules:
      - dsh-doctor
      - dsh-evolve
      - dsh-evolve-web
      - dsh-software-delivery
```

在任意支持 DSH 原生 Commands 的交互面执行 `/doctor`。它只读一次 Loader，并返回
`READY / NOT READY / UNKNOWN`、具体 entry 和下一步；不自动 enable、重启或修复，也不调用模型。
详情见 [`dsh-doctor` README](../packages/dsh-doctor/README.md)。

### P2 Software Delivery 装配

`dsh-software-delivery` 也是普通 Cordis plugin。装配原生 Skill registry 后添加：

```yaml
- id: skill
  name: '@deepseek-ai/dsh-skill'
- id: dsh-software-delivery
  name: dsh-software-delivery
```

若仓库要求远端 CI 也成为 Goal 完成条件，显式开启：

```yaml
- id: dsh-software-delivery
  name: dsh-software-delivery
  config:
    requireDraftPrChecks: true
```

默认值为 `false`。开关位于 host plane，不增加或修改模型 Tool。

创建可信本地配置并验证一个已经 commit 的 linked worktree：

```json
{
  "schemaVersion": 1,
  "baseRef": "main",
  "checks": [{ "name": "test", "argv": ["pnpm", "test"] }]
}
```

```bash
dsh-delivery verify \
  --worktree /absolute/path/to/linked-worktree \
  --config /absolute/path/to/delivery.json
```

退出码 `0/1/2` 分别表示 `passed/failed/unknown-or-invalid`。验证配置会执行精确 argv，
因此必须是可信本地输入；它不是 untrusted-code sandbox。详情见
[`dsh-software-delivery` README](../packages/dsh-software-delivery/README.md)。

若同一 composition 已有原生 Goal、`update_goal` 和 `bash/pwsh`，插件还会自动注册稳定的
`complete_delivery` Tool。它通过原生 shell policy 执行 exact argv，并只在所有证据通过时
调用原生 `update_goal complete`；不需要配置第二个工作流或状态库。

需要 GitHub Draft PR 时，在同一次 Tool 调用增加：

```json
{
  "draft_pr": {
    "base_branch": "main",
    "title": "feat: verified change",
    "body": "Summary and verification evidence"
  }
}
```

当前要求 GitHub.com、已登录 `gh`、`origin` 同仓 branch。它只创建或复用 Draft，不 merge、
不转 ready，也不读取或输出 token；命令仍由原生 shell policy 决定。

启用 `requireDraftPrChecks` 后，同一次调用还会核对 Draft PR 的 `headRefOid` 与
`statusCheckRollup`：exact head 至少有一项且全部绿色才完成 Goal；failed 返回 `failed`，pending、
缺失、无法读取或 head 漂移返回 `unknown`，Goal 都保持 active。插件不后台等待、不轮询；稍后
重试会重新验证本地 commit/check、复用同一个 PR 并读取最新远端事实。当前读取全部 rollup checks，
不是 GitHub required-only 规则，也不下载 CI 日志。

如果同一 DSH composition 也加载 `dsh-evolve`，无需再增加 Tool 或配置 Adapter。Evolve 会
旁路观察最终 `complete_delivery` 结果并关联该 Session 的 Generation；`/evolve status` 增加：

```text
Delivery outcomes: 4 total (2 passed, 1 failed, 1 unknown)
Active selection outcomes (<generation-id-or-native>): 2 total (2 passed, 0 failed, 0 unknown)
```

计数最多来自最近 1000 条幂等记录，不包含 Prompt、仓库路径、PR 正文或 check 输出。记录失败
不会延迟或改变原 Tool；单次失败也不会触发自动回滚。

如果 composition 同时加载 DSH 原生 `@deepseek-ai/dsh-message-feedback`，无需增加新的学习命令。
用户在已有消息反馈 UI 中选择负反馈并填写非空备注后，`/evolve status` 还会显示：

```text
Explicit feedback signals: 3 retained (1 active selection)
```

完整 Session lifecycle 只在事件当下用于精确 Generation 归属；派生记录只保存 Session/message
引用、opaque feedback version、时间和 pinned Generation，不保存 createdAt、cwd 或其 hash，
也不复制 note、note hash、Prompt、Transcript 或消息正文。用户改成正反馈、
删除反馈或移除备注会撤回派生引用。该入口不调用模型，也不会直接创建 Candidate、晋升或回滚；
当前最多保留 1000 个 Session、每个 Session 100 条引用。

如需把其中一条纠正保存为后续 evaluator 的输入，先显式配置一个私有目录：

```yaml
feedbackDraftRoot: /absolute/path/to/.dsh/evoforge/private-feedback-drafts
```

这表示允许复制最小原文，但不会自动复制任何内容。还必须在 host plane 逐条执行：

```text
/evolve feedback
/evolve feedback <64-char-signal-id>
/evolve feedback <64-char-signal-id> draft <skill-name>
```

创建时会重新核对当前 feedback version、Session 生命周期、pinned Generation、exact Git Skill，
并要求目标 turn 只有一个直接纯文本用户消息和恰好一次目标 Skill 的显式 invocation。目录权限不能
向 group/world 开放；草稿文件不含 assistant response、Tool output、Skill body、cwd 或完整
Transcript。草稿状态固定为 `draft`，没有 replay score，不会创建 Candidate、调用模型或触发发布。

如果已有一个可信、经过 known-bad/known-correction 校准且覆盖该失败类型的 Case Pack，可以显式
让这条纠正只引导一次 proposer 搜索：

```bash
dsh-evolve shadow /absolute/path/to/exact-skill \
  --case-pack /absolute/path/to/trusted-case-pack \
  --feedback-draft /absolute/path/to/private/<draft-id>.json \
  --output /absolute/path/to/runs/run-001
```

该命令会验证草稿权限、内容 id、目标 Skill 名和 whole-Skill content hash。直接用户文本和
correction 只作为输入进入本次 proposer 请求；calibration 和 hidden evaluator 不会看到草稿，报告、
proposal evidence 和 run journal 不直接复制输入字段。但 proposer 若在 claim/Candidate 中回显或
转述，输出会为 crash-resume 持久化。CLI 调用表示用户授权这一次可能付费的请求，并允许向当前
配置的 provider 发送草稿原文。最大额外正文为 12 KiB，粗略最坏约 3,072 input tokens，并与 Skill
和 search evidence 共用 manifest 的 `inputTokenLimit`。没有显式 Shadow 时，正常 DSH Session 的
额外 token 仍为 0。

常用 Skill 可以把这些固定输入预先声明为静态 Target，避免用户复制绝对路径：

```yaml
supervisor:
  runRoots:
    - /absolute/path/to/.dsh/evoforge/plugin-delivery-runs
  scanIntervalMs: 30000
shadowTargets:
  - id: plugin-delivery
    skill: build-dsh-plugin
    casePackDir: /absolute/path/to/trusted-case-pack
    runRoot: /absolute/path/to/.dsh/evoforge/plugin-delivery-runs
```

每个 Target 使用一个已在 `supervisor.runRoots` 中声明的独立 run root；最多 20 个。还必须装配
原生 Jobs、Message Feedback 与 Session Persistence。之后可从 Web 确认，或执行：

```text
/evolve feedback <64-char-signal-id> shadow plugin-delivery
```

该动作逐次授权一次可能付费的 proposer 请求和受限纠正外发，并立即返回。系统在 host 端重新
创建/核对 exact 私有 Draft，只把 signal id 与 target id 暴露给 Commands/Web。相同 signal、Draft、
Skill tree、Case Pack 和模型 route 派生相同 launch id；已有 durable journal 时复用而不重复请求。
它不会自动创建 evaluator 或晋升 Candidate。

如果该纠正没有可信 Case Pack，可另外配置最窄 Evaluator Target：

```yaml
evaluatorTargets:
  - id: plugin-delivery-evaluator
    skill: build-dsh-plugin
    root: /absolute/path/to/.dsh/evoforge/private-evaluator-drafts
    dshRevision: 47f943859bef60e4160492346772ded9b24f765a
```

`root` 必须是每个 Target 独占的私有 absolute directory，不能是 symlink；`dshRevision` 必须是
完整 Git object id。首片只支持 tree 中恰好一个 `SKILL.md` 的纯指令 Skill。还必须配置
`feedbackDraftRoot` 并装配原生 Jobs、Message Feedback 与 Session Persistence。使用：

```text
/evolve feedback <64-char-signal-id> author plugin-delivery-evaluator
/evolve evaluator
/evolve evaluator <64-char-draft-id>
/evolve evaluator <64-char-draft-id> approve <independent-review-note>
/evolve evaluator <64-char-draft-id> reject <reason>
```

Author 每次逐次确认一次可能付费的请求和 bounded correction/exact Skill 外发，host 固定生成
manifest 与 known-bad；输出上限 1600 token。结果保持 private/inactive。Approve 是另一项人工
exact-hash 决策，才允许 generated evaluator 进入 sealed DSH qualification。通过只发布 Qualified
Case Pack，不启动 Shadow、Candidate 或 Promotion。不确定 provider effect 在重启后不自动重试；
normal Session、列表、detail 与 qualification 的 proposer token 均为 0。

### Evolve Web Bundle 装配

发布后，一条命令安装 host runtime 与 Web Adapter：

```bash
dsh plugin --profile web add dsh-evolve-web
```

从本仓库验证本地 tarball 时，因为 `dsh-evolve` 尚未发布，两个 artifact 必须在同一次调用中安装：

```bash
pnpm --filter dsh-evolve pack --pack-destination "$PWD/.evoforge/pack"
pnpm --filter dsh-evolve-web pack --pack-destination "$PWD/.evoforge/pack"

dsh plugin --profile web add \
  "$PWD/.evoforge/pack/dsh-evolve-0.1.0-alpha.1.tgz" \
  "$PWD/.evoforge/pack/dsh-evolve-web-0.1.0-alpha.1.tgz"
```

Bundle 默认只加入 `dsh-evolve` 和全局 Web 入口；不会猜测 run root，不启用 supervisor、Git
source、私有反馈复制或自动晋升。无 Session 时也能从侧栏“演化”打开面板。Remote 只在打开、
刷新和动作后读取，不注册 Tool/Prompt/Skill/System/Session surface，普通模型请求额外 token 为 `0`。
卸载使用：

```bash
dsh plugin --profile web remove dsh-evolve-web
```

高级运行配置应作为 profile 中更晚的显式 patch，例如：

```yaml
- id: evoforge-evolution
  config:
    cacheRoot: !!js dshHomePath('evoforge', 'git-skills')
    supervisor:
      runRoots:
        - !!js dshHomePath('evoforge', 'runs')
      scanIntervalMs: 30000
```

### P0B runtime 手工装配

不需要 Web 时，`dsh-evolve` 仍可作为普通 Cordis runtime plugin 手工装配。在 DSH Storage
Domain 已装配的配置里添加：

```yaml
- id: dsh-evolve
  name: /absolute/path/to/dsh-evoforge/packages/dsh-evolve/dist/index.mjs
  config:
    cacheRoot: /absolute/path/to/.dsh/evoforge/git-skills
    feedbackDraftRoot: /absolute/path/to/.dsh/evoforge/private-feedback-drafts
    sources:
      - name: build-dsh-plugin
        repository: /absolute/path/to/owned-repository
        path: skills/build-dsh-plugin
    supervisor:
      runRoots:
        - /absolute/path/to/.dsh/evoforge/plugin-delivery-runs
      scanIntervalMs: 30000
    shadowTargets:
      - id: plugin-delivery
        skill: build-dsh-plugin
        casePackDir: /absolute/path/to/trusted-case-pack
        runRoot: /absolute/path/to/.dsh/evoforge/plugin-delivery-runs
    evaluatorTargets:
      - id: plugin-delivery-evaluator
        skill: build-dsh-plugin
        root: /absolute/path/to/.dsh/evoforge/private-evaluator-drafts
        dshRevision: 47f943859bef60e4160492346772ded9b24f765a
    autoPromote:
      skills:
        - build-dsh-plugin
```

每个 Generation artifact 的 `name` 都必须有一条 source。Repository 必须能解析
manifest 中的完整 commit 和 tree object id；晋升前会物化并逐 blob 验证普通
non-executable 文件。`cacheRoot` 只是带 owner marker 的只读重建缓存，Git 才是事实源。

装配原生 `@deepseek-ai/dsh-commands` 后，普通用户可以使用：

```text
/evolve status
/evolve feedback
/evolve feedback <64-char-signal-id>
/evolve feedback <64-char-signal-id> draft <skill-name>
/evolve feedback <64-char-signal-id> shadow <target-id>
/evolve feedback <64-char-signal-id> author <evaluator-target-id>
/evolve evaluator
/evolve evaluator <64-char-draft-id>
/evolve evaluator <64-char-draft-id> reject <note>
/evolve evaluator <64-char-draft-id> approve <note>
/evolve review
/evolve review <64-char-review-id>
/evolve review <64-char-review-id> reject <note>
/evolve review <64-char-review-id> approve <note>
/evolve pause
/evolve resume
/evolve promote <64-char-generation-id>
/evolve rollback
```

除显式 `feedback ... author` 会提交一次 bounded 后台模型请求外，状态、review、reject、approve、
pause/resume/promote/rollback 命令不调用 proposer。Evaluator approve 会执行 sealed 本地资格验证，
不会请求 proposer。`review` 从配置的 run roots 投影已完成 Shadow 证据；reject 只记录
证据绑定的处置，approve 只创建 owned Git ref 和 inactive Generation。它不会移动用户
branch/worktree 或 active pointer。只有随后显式 `promote` 才改变 future Session；当前
Session 始终不漂移。不要把 P0C 人工命令当作已完成的自动晋升产品。

`supervisor` 可省略。启用时还要在同一 DSH composition 中装配原生
`@deepseek-ai/dsh-jobs-local`（或兼容 `ctx.jobs` 实现）。每个 `runRoots` 只扫描直接
子目录，不跟随符号链接；自动恢复仅接受已落盘 Candidate 的
`candidate-ready` / `trial-running`。`prepared` 不会自动调用模型，
`proposal-pending` 也不会自动重试。当前 Job 可从 DSH host plane 观察或取消，重启
事实仍来自 `run-state.json`，而不是易失的 Job record。
取消 Job 后，同一 DSH 进程不会再次自动提交该 run；下次 DSH 启动仍可从未终结
journal 继续。`/evolve pause` 则先持久化全局 resident pause，再取消当前 recovery；
重启仍保持暂停。`/evolve resume` 持久化解除并立即唤醒扫描。两者不暂停普通 Session、
显式 Shadow CLI 或人工 review/release。

Review 使用和 supervisor 相同的 `runRoots`，但不要求安装 Jobs。它只扫描直接子目录，
并要求 journal、report 和处置文件都是 owned regular file。`review` 列表展示 pending
候选；详情展示 claim、changed files、tree、逐 case、proposal token、Trial 次数、
composition、理由、限制，以及 exact Git baseline 到 sealed Candidate 的逐行 diff。Diff
复用批准时相同的 baseline/Candidate whole-tree gate，不读取 `resumeInputs.skillDir`；最多
显示 16 KiB，控制字符可见转义，截断会报告显示/总字节数。查看不会调用模型、持久化 patch
或修改 release state。详情还会基于同一 exact baseline 的变更文本显示固定版本的
protected-effect 词法类别；结构范围扩大或改写 `SKILL.md` 也会单独提示。否定句不会被当作
安全豁免，`none detected` 也不表示安全。DSH Approval/Permission/Sandbox 仍决定实际动作。
若 exact Git baseline 已漂移则失败关闭。

`autoPromote` 可完全省略；省略或 `skills: []` 即关闭。开启时必须同时配置 supervisor 并
装配 native Jobs。只有 allowlist 内 Skill 的 exact baseline、assembled composition stable、
sealed `fail → pass`、全部 checks、Trial≥4 和单一 `SKILL.md` ≤2 KiB append 同时满足才
自动晋升。详情命令会解释未满足的门。代码、工具、权限、protected-effect 词或其他文件
一律转人工。pre-alpha 阶段不要在生产 profile 开启。

## 3. Shadow 输入

若失败类型尚无可信 Case Pack，先显式调用仓库内
[`author-dsh-evolution-case`](../skills/author-dsh-evolution-case/SKILL.md)。它要求先证明同一个
observable 在 known-bad 上失败、在人工确认 correction 上通过，并加入能识别“措辞对但行为错”的
negative control，再进入下述校准。该 Skill 禁止隐式调用，不进入 DSH profile 或普通 Session；
没有独立可重放 observable 时应停在 investigation，而不是让模型同时生成 Candidate 和 grader。

先在不配置任何模型 route/key 的情况下验证一个完整 Case Pack：

```bash
dsh-evolve calibrate \
  --case-pack ./case-pack \
  --output ./runs/case-pack-calibration-001
```

命令只执行 known-bad 和 known-correction 两次 sealed evaluator，并写入
`calibration-report.json`。方向正确退出 0；方向错误或执行证据不完整退出 2。它不创建 Candidate、
不读取 proposer 环境变量、不产生模型 token，且要求 output 是 Case Pack 外部的新目录。完整 Shadow
会自动先跑同一门，只有通过后才请求 Candidate；成功路径仍共四次 Trial。

命令：

```text
dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir> [--feedback-draft <private-draft.json>]
```

若同一个 output run 被进程中断，保持 Skill、Case Pack、模型 route 不变并显式恢复：

```bash
dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir> [--feedback-draft <private-draft.json>] --resume
```

若中断发生在付费 proposal 已发出但 response 尚未 durable 的窗口，恢复返回
`2 + incomplete/uncertain`，不会自动重试。若 Candidate 已 durable，则只重跑
无网络的 Sealed Trial。并发恢复会被 run owner lock 拒绝。

`skill-dir` 必须包含带 `name` frontmatter 的 `SKILL.md`。只有安全门的最小
Case Pack 可以不声明 Trial；要得到 in-scope Candidate 的完整建议，manifest
还必须声明 search evidence、隐藏 evaluator 和两个 calibration tree：

```json
{
  "schemaVersion": 1,
  "id": "real-browser-e2e",
  "epoch": {
    "dshRevision": "0.1.0-rc.6",
    "evaluatorVersion": "browser-e2e-guidance-v1"
  },
  "budget": {
    "candidateLimit": 1,
    "trialLimit": 4,
    "inputTokenLimit": 4000,
    "outputTokenLimit": 600
  },
  "search": {
    "evidence": "search/evidence.md"
  },
  "trial": {
    "evaluator": "final-test/evaluator.mjs",
    "timeoutMs": 5000,
    "outputLimitBytes": 65536
  },
  "calibration": {
    "knownBad": "calibration/known-bad",
    "knownCorrection": "calibration/known-correction"
  }
}
```

完整目录示例见
[`examples/case-packs/browser-e2e-guidance`](../examples/case-packs/browser-e2e-guidance)。
proposer 只会收到 active Skill 和 `search.evidence`；calibration tree 与
`trial.evaluator` 不进入模型请求。macOS 实现会分别复制 known-bad、
known-correction、baseline 和 Candidate，执行四次 Sealed Trial。Evaluator 必须是
一个只依赖 Node.js builtin 的 ESM 文件，并向 stdout 输出：

```json
{
  "schemaVersion": 1,
  "passed": true,
  "checks": [{ "name": "check-name", "passed": true }]
}
```

需要验证真实 DSH 组合时，Trial 可显式声明：

```json
{
  "trial": {
    "evaluator": "final-test/evaluator.mjs",
    "timeoutMs": 15000,
    "outputLimitBytes": 65536,
    "dshAssembled": true
  }
}
```

此时还必须设置 `DSH_EVOLVE_DSH_SOURCE_DIR`，指向已经安装依赖并完成
`build:lib:host` 的 DSH checkout。Host 会先确认它是 `@deepseek-ai/dsh-root`，再用
Git 检查实际 `HEAD` 与 `epoch.dshRevision` 完全相同。DSH tree 只读挂载；
workspace 仍是唯一可写区域。Evaluator 除普通 checks 外必须返回真实组合证据：

```json
{
  "schemaVersion": 1,
  "passed": true,
  "checks": [{ "name": "real-loader-agent-turn", "passed": true }],
  "composition": {
    "fingerprint": "64-char-sha256",
    "modelCalls": 2,
    "usage": { "inputTokens": 18, "outputTokens": 8, "cacheReadTokens": 2 }
  }
}
```

公开 assembled 示例见
[`examples/case-packs/browser-e2e-guidance-assembled`](../examples/case-packs/browser-e2e-guidance-assembled)。
它使用无密钥脚本 Adapter 跑真实 Loader、Agent Loop、Skill 注入和 bash Tool，
用于验证装配与 KV Cache 归因，不代表真实模型已经改善。

Case Pack 是可信本地输入，但 evaluator 仍运行在无网络、无父环境秘密、限制
读写范围、时间和输出的进程中。当前没有 workspace 磁盘配额。

Shadow 使用一个显式配置的 OpenAI-compatible proposer：

```bash
export DSH_EVOLVE_MODEL_BASE_URL=https://provider.example/v1
export DSH_EVOLVE_MODEL_NAME=model-name
export DSH_EVOLVE_MODEL_API_KEY=secret

node packages/dsh-evolve/dist/cli.mjs shadow ./skill \
  --case-pack ./case-pack \
  --output ./runs/run-001
```

仓库内示例路径可替换为：

```bash
node packages/dsh-evolve/dist/cli.mjs shadow \
  ./examples/skills/browser-e2e-baseline \
  --case-pack ./examples/case-packs/browser-e2e-guidance \
  --output ./runs/browser-e2e-demo
```

assembled 示例还需要：

```bash
export DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/deepseek-harness

node packages/dsh-evolve/dist/cli.mjs shadow \
  ./examples/skills/browser-e2e-baseline \
  --case-pack ./examples/case-packs/browser-e2e-guidance-assembled \
  --output ./runs/browser-e2e-assembled
```

自动化测试使用本地固定 HTTP proposer 来验证框架行为；真实 provider 是否能提出
有效修正是另一项实验结论，不能由该固定响应替代。

这可能产生付费模型调用。带 `--feedback-draft` 时还会把该草稿的直接用户文本和 correction 发给
同一个 provider，因此只应选择允许外发的草稿。不要把 API key 写进 manifest、命令历史、Issue、
测试 fixture 或 Git；程序不会将环境变量中的 key 写入报告。

## 4. 退出语义

- `0`：一次完整业务结果；可能是 `promote`、`review` 或 `reject` 建议，但绝不自动激活；
- `1`：参数、目录、配置或兼容性错误，未开始有效 Trial；
- `2`：评测不完整；模型失败、预算超限、平台无 Sealed Trial、active Skill 或 Case Pack 被并发改变等均走这里。

`2` 不是失败掩盖，而是核心安全合同：证据不足时不猜测 `promote/review/reject`。

## 5. 开发下一纵切

在修改代码前阅读：

1. [CONTEXT.md](../CONTEXT.md)
2. [需求基线](requirements.zh.md)
3. [插件接口规范](plugin-contract.zh.md)
4. [P0A Shadow 契约](architecture/p0a-shadow-contract.zh.md)
5. [ADR-0006：Sealed Trial](adr/0006-fail-closed-sealed-trial-execution.md)
6. [CONTRIBUTING.md](../CONTRIBUTING.md)

新增行为先写穿过公共接缝的红测试。只有模型、外部 provider 或操作系统边界可以被替换；不要 mock evaluator 内部阶段后再声称端到端通过。
