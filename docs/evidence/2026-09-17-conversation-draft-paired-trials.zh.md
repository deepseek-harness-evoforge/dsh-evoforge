# 普通聊天草稿的有限原生对照

最新结论：一次零发送初始化恢复后，真实八分支已完成并冷重启读回，四组首请求可比，原草稿仍未启用。
固定字面断言给出 baseline 0/4、draft 0/4、`no-improvement`；事后核查发现断言对等义改写过于敏感，
这些分数不是八次真实任务全部失败的证明，也没有证明草稿改善。后续应先改善评测准入质量，不能重跑本组挑选有利答案。

## 真实调用前冻结的计划

对象是此前真实生成、尚未启用的 `wide-table-to-item-sections`，不是手工改写的 Skill 或操作者提供的测试包。
草稿内容 hash：`5d173a7b83a649fbdf7573b97e8db61edabd511cdce1bf3343d50fb43f115808`。
四项封存检查的 governance digest：`686b1b4a1f2d74f9983ac757e0228e3bc2e964c3276e941415f2bd228b8b5e1c`。
本次未向草稿作者提供测试输入、参考答案、负例或结果；不会看到输出后改题、改稿或重试挑选有利结果。

- 只在原授权验收 Workspace 中使用现有单一 DSH Host、原生 provider/model 和凭据。
- 四项自包含任务各有 baseline/draft 两个新建原生 Session；按题交替先后顺序，不新建 Host、Gateway 或 Codex 子智能体。
- 一次持久预留 24 个请求名额，每个分支最多三次、每次最多 2000 输出 token，90 秒后取消并等待原生资源释放。
- 原生工具只开放 Skill 读取；draft 分支只增加该草稿的 scoped catalog/body。模型自主决定是否调用官方 `skill`。
- 先确认 completed turn、无工具失败、四组完整首请求可比，再统计固定断言。改善分支未加载草稿不能归因于草稿。
- 同时保留通过、失败、相同结果、退步和不确定；不自动重跑、安装、启用、晋升或改写原会话。
- 记录原生日志、请求 digest、已知 token 和耗时；缺失 cache/usage/费用保持未知。测试 Session 历史保留以供审计。

这些是独立请求生成的有限检查，不是经人工确认的全部事实标准，也不是完整发布、泛化或 Hermes 对照结论。

## 实现与无密钥验证

DSH canonical fetch 仍为 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` / `0.1.6-alpha.1`，检出干净。
`pnpm install --frozen-lockfile` 与完整 `pnpm run build` 成功，未修改上游。

内部原生执行模块接入 Workspace 策略、私有 native Domain、原生 Jobs 和只读控制面；契约见
[2.5 普通草稿的有限原生对照检查](../plugin-contract.zh.md#25-普通草稿的有限原生对照检查)。
`@deepseek-ai/dsh-llm` 作为 Host peer，不再打入插件 bundle。原生持久化测试曾发现跨模块 WeakSet 请求标记失配；
关联改为原生 Agent 请求信号、精确 Session id、原任务和已持久化 marker，并保留独立实例测试覆盖。

执行过的相关命令（`AUDITED_DSH_SOURCE` 表示本轮已审计 checkout，真实路径已脱敏）：

```sh
DSH_SOURCE_ROOT="$AUDITED_DSH_SOURCE" node scripts/generate-typert.mjs
pnpm --filter dsh-evolve run build
pnpm --filter dsh-evolve-web run build
DSH_EVOLVE_DSH_SOURCE_DIR="$AUDITED_DSH_SOURCE" pnpm --filter dsh-evolve exec vitest run test/config-contract.test.ts test/package-declarations-contract.test.ts test/conversation-correction-intake.test.ts test/conversation-correction-native.e2e.test.ts test/conversation-skill-draft.test.ts test/conversation-draft-trial-guard.test.ts test/conversation-draft-trial-store.test.ts
DSH_EVOLVE_DSH_SOURCE_DIR="$AUDITED_DSH_SOURCE" pnpm --filter dsh-evolve exec vitest run test/package-runtime-surface.test.ts test/evolution-control-plane.test.ts test/evolution-settled-event.e2e.test.ts
pnpm --filter dsh-evolve-web exec vitest run
pnpm --filter dsh-evolve exec tsc --noEmit -p tsconfig.test.json
pnpm --filter dsh-evolve-web exec tsc --noEmit -p tsconfig.test.json
pnpm run check:docs
git diff --check
```

当前通过：Host 相关两组 60/15 项、Web 40 项、构建及类型检查。原生 JSON Storage/Session persistence/Jobs 测试
执行全部八个分支、加载官方 Skill、冷重启读取相同记录且不重复调用，原会话逐事件不变；此处模型仍是无密钥 fixture。
fixture 中两边均通过四项，明确记录为 `no-improvement`，没有把 equal outcome 改判为学习成功。

## 部署与真实结果

2026-09-17 已通过官方 CLI 将 `dsh-evolve` 与 `dsh-evolve-web` 更新到持久内容地址
`d6caa504c6fec695c04a29f8e211a53f200657c82cd1fc0829f2e86f8ababd15` 对应的 product pack。
只更新这两个包；保留旧 pack、配置备份、原生历史和凭据。默认关闭启动后，显式为原验收 Workspace 配置
24 次/UTC 日的试验策略并重启同一个 Host。端口检查确认只有一个进程监听 `127.0.0.1:3000`。

真实计划 `17171e9db4dbf9b7954a298a90cdb9ae6d1e5dfd73ba63dbf9df6272bc38c621` 已终止为
`uncertain / execution-failed`：第一个 baseline 分支为 running，后七个 pending，全部 dispatch marker 为零，
没有已保存的结果或用量。原生 sessions 目录未发现这八个试验身份的文件；尚不能证明具体初始化失败点。
24 个名额为保守预留，不是 24 次实际模型消耗。原始失败记录保留，没有删除计划、重跑或修改封存草稿与题目。

只读复核执行了官方 `--profile web --dump-config`（仅输出匹配的模块名称）、原生 Domain 的 phase/marker 投影、
sessions 文件名检查及 `lsof -nP -iTCP:3000 -sTCP:LISTEN`。有效配置包含原生 `tool-skill` 与 `agent-loop`。
另一个无密钥、无网络监听的最小运行时在缺少 `tool-skill` 时能复现初始化拒绝，但它与真实配置不一致，
不能据此认定线上根因。当前 catch 丢失具体异常，后续需用受限诊断取得真实初始化原因。

结论：部署已执行，真实对照未完成，改善、退步、可比性和实际成本均未测得。无密钥测试通过不能覆盖此次失败，
也不能替代真实效果、部署后冷恢复或完整 clean-profile 卸载验收。

### 初始化诊断与修复

随后在同一个真实 Host 临时加载了仅用于诊断的官方 Cordis 模块。它使用无业务内容的独立 Session identity，
在 beforeDispatch 强制拒绝，并另加精确 Session 的 LLM 发送拒绝；未读取封存测试题、未发出模型请求。
启动立即运行的诊断先发现工厂尚未注册；等待启动完成的诊断则得到
`tools.restrict() names unknown global tool "skill"`。直接检查新建 Agent 的工具视图只有 `report_capability_gap`，
没有 `skill`；有效配置中列出工具模块不代表程序化 Agent 自动继承了用户 preset。

修复只在缺失读取工具的试验 Agent 内挂载官方 Skill 插件；已有工具时复用其目录监听器，避免双重目录组成。
工具限制区分全局与局部注册，不改变普通会话权限。新增无全局 Skill 工具的回归测试修复前明确失败；
原生持久化八分支测试也改用与部署一致的无全局 Skill 配置。四文件 18 项测试、runtime surface 两项及类型检查通过。
这些 fixture 验证配置和生命周期，不证明草稿改善。

修复后的真实 Host 诊断到达 beforeDispatch，并按预设停止：`dispatchMarkers=0`、`requestCount=0`。
移除诊断配置后，`cmp` 确认 profile patch 与诊断前备份完全相同。保留诊断原生历史和私有诊断结果；
原失败计划仍为 uncertain，未重发、未替换草稿或治理材料。最初失败记录没有保存具体异常，因此不能反推它首先遇到
工厂时序还是工具缺失；这里证明的是可重复的工具配置缺陷及其修复，不是原始调用的完整异常追踪。

修复已打包到 product manifest hash `8a709c567c5354d8fa42f67997e4475ccd7aeec083c7e8e146e74392d9857bad`，
逐包 SHA-256 校验后移入持久内容地址；此次只通过官方 `plugin --profile web add <exact-tarball> --ignore-scripts`
更新 `dsh-evolve`，其余已安装包保持原版本。官方安装退出 0。`pnpm peers check` 仍报告 Host 提供的原生包未列在
独立 profile 的依赖树中；不能将该检查称为通过。实际 Host 加载与浏览器控制面恢复正常。
诊断验证使用修复后的本地编译模块；部署产物完成了构建/原生外置依赖检查和启动，但没有重跑真实封存实验。

部署后只有一个 Host 监听 `127.0.0.1:3000`。浏览器 reload 后仍是原会话 22 轮/47 步、原模型与权限，
对照区显示“实验未完成或结果不明，不自动重跑”、0/8 分支和零已记录请求，没有伪报成功。
逐字节检查诊断前备份的 22 个原生历史文件与七个原插件存储文件全部相同；profile patch 也相同。
试验 Domain 仍只有原失败计划且全部 marker 为零。完整效果对照、受控零调用恢复和 clean-profile 全生命周期验收仍未完成。

### 零发送恢复后的真实结果（本轮最终状态）

新增默认关闭的 `retryFailedTrials` 一次性初始化恢复，规则见契约 2.5：零 marker、零结果的 uncertain 根计划，
原来源/草稿/治理/model route 完全相同、有限期授权、共享预算、确定性唯一子记录和冷恢复父子校验。
新的 Session id 区分尝试，旧失败及旧预留不覆盖。已经发送、已有结果或恢复子记录均不能再次恢复。

无密钥验收：七个 Host 测试文件 42 项、Web 两文件 40 项、两包类型检查、构建和官方 Typert 生成通过。
原生测试包含失败根计划→原生 Jobs 自动发现恢复→八分支→物理历史读回→冷重启相同结果且不新增调用；
另测并发、跨日、过期/撤回、预算不足、来源/model route 变化、父子记录篡改及任意已发送 marker 的拒绝。
这些不是实际效果证据。

真实部署的 product manifest hash 为 `7edc05eebd2e4dbd7be5e1c63475b6c314b2f94ccd66cbe9098e3dc0515f2c99`；
只通过官方 CLI 更新 `dsh-evolve` 与 `dsh-evolve-web`，其他包和原凭据保留。原 Workspace 临时上限 48，
仅授权此前 root `17171e9db4dbf9b7954a298a90cdb9ae6d1e5dfd73ba63dbf9df6272bc38c621` 的一次恢复。
原生 Jobs 生成 child `a9847dc930eed234aa77d341a0dec515d3fb530b94961e0ebb04cde4d5ae5923`，没有改写草稿或题目。

| 指标 | 实测 |
|---|---:|
| 原生分支 completed / 总数 | 8 / 8 |
| 首请求组成可比 | 4 / 4 |
| baseline / draft 固定字面断言通过 | 0 / 4；0 / 4 |
| draft 实际加载次数 | 2 / 4（两个 holdout；retention 未加载） |
| 已记录请求 / dispatch marker | 10 / 10 |
| 已知输入 / 输出 token | 9357 / 1567 |
| 分支用时合计 | 54,510 ms |
| 用量缺失请求数 | 0 |
| cache-read / cache-write / 费用 | 未提供，未知 |
| 固定比较结论 | no-improvement |

运行结束后才对封存断言和答案做只读核查：未发现禁止串命中，各分支结构符合要求的表格/无表格形式；
失败来自 mustInclude 的逐字要求，例如 Markdown 加粗与字段空格、同义句、数字写法或包含更多日期上下文的表格单元格。
测试并未要求逐字复述这些参考句，因此当前分数不能当作任务完成度。没有修改断言、补发模型请求或改写已保存结论；
此事后分析不是独立新评测，也不授予 Skill 激活。

用当前官方 Session persistence 的只读接口逐个读取八份真实日志，event digest 全部与分支结果一致，
各有一个 completed turn，共十个 assistant request 结果。保留恢复授权进行一次真实冷重启，账本字节完全相同，
页面恢复 8/8、10 次请求，原生后台任务没有重跑实验。随后撤回授权并恢复上限 24，再启动同一个 Host。
历史预留仍为 48，页面的 48/24 表示此前授权留下的保守预留，不是新的授权或新增消耗。

原来的 22 个 Session 文件、七个相关插件账本逐字节不变，原会话仍为 22 轮/47 步；原失败 root 内容保持不变。
浏览器真实刷新与窄屏截图检查显示恢复结果和原失败记录并列，没有启用按钮或学习成功提示。
临时授权和诊断配置已撤回；原生试验/诊断历史保留。回退包须支持带 retryOf 的试验 schema，不得覆盖历史绕过预算。
尚未完成完整 clean-profile 移除验收、稳健的语义评测准入、未来 Session 启用/回滚与 Hermes 同条件比较。
