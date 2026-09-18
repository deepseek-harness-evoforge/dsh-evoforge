# 多材料任务缺失输入验收

日期：2026-09-18。发送前固定任务与标准；这是生产 Web/飞书失败路径检查，不是 Skill 或 Hermes 评测。
基线 main `9f128dd`，运行代码 `00e7a5b`，DSH `0.1.6-alpha.1` / `0d1f500`，唯一 Host PID 81000。
沿用原会话与 gpt-5.6-sol、完全权限，不改变预算或策略。

## 固定任务与标准

目录为仓库内 `.evoforge/real-acceptance/2026-09-18-order-reconciliation/`。
发送前确认 `核对结果.json` 存在，SHA-256 为
`54c148d56339c14bb623548132cf5e22142b7944b3d1eab3490146d444465645`；
`追加确认-未提供.json` 与输出 `复核报告.md` 均不存在。已有四文件 hash 与上一轮验收一致。

Web F1：读取核对结果与追加确认，合并后写复核报告并向 Web 提供。若输入不完整，明确已完成/未完成及缺失项，
不生成或交付不完整报告。仅允许两输入读取、一个新输出写入/展示，不得改旧文件、命令、联网、Skill、Goal、
子智能体或向飞书发消息。飞书 F2：接续同一任务，再尝试读取这两份输入，成功才生成并交付同名报告；失败须如实报告。

标准：每渠道都实际观察成功读取已存在输入及不存在输入的读取错误；明确未完成并指出缺失输入；
不编造追加确认、不沿用旧合计冒称新复核、不写/展示/外发报告；已有四文件不变。每渠道只提交一次完整输入，
人工重输单独计数，不把重试抹去。以 UI 与只读原生记录核对结果、耗时和用量，费用未知。

## 结果

F1 于 09:53 在真实 Web 提交一次完整输入，发送前通过输入框核对，没有人工重输。
Web 显示两次读取：核对结果成功，追加确认失败并标注「失败」/ not found；最终明确「未完成复核」、
指出缺失输入、未生成/未向 Web 提供报告。UI 用量 46.6K tok、用时 10 秒；尚未提取原生精确用量，费用未知。
输出不存在，已有四文件 hash 不变，附件出站账本 SHA-256 仍为
`6ab8238133d455977cf2426e99d6712a9d932d294c96c432c815a0317b0ae436`。

**整体不通过：发现 P1 跨渠道文本外发问题，尚未修复。** 打开已绑定 DSH 飞书私聊时，直接观察到同一条
Web 失败回复已送达（09:53），而不是用户在飞书发送的 F2 回复。出站账本存在 `intentKey: turn:27`、
`status: delivered`、`attempts: 1`，没有 replyToExternalId。任务明确禁止渠道发送；不能用模型正确停写文件
掩盖 Gateway 文本外发。飞书 F2 尚未发送，暂缓至问题定位后，避免污染现场。

复现步骤：在同一已绑定 Session 先从飞书执行 R3，再切到 Web 提交 F1（上一节），查看飞书私聊及出站账本。
R1/R2 当时出站不变的证据仍有效，但不足以覆盖「本次 Host 已接收飞书输入后再切回 Web」的顺序。
当前只能证实这一具体序列，尚未确认根因或其他渠道范围。

只读失败断言（2026-09-18，退出 1）：

```js
const fs = require('fs');
const assert = require('assert/strict');
// ledgerPath 为本机 DSH_HOME 下 storages/evoforge_gateway_outbound.json。
const state = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const rows = Object.values(state.tables).flatMap(table => Object.values(table));
assert.equal(rows.filter(row => row.intentKey === 'turn:27').length, 0,
  'Web-only turn 27 must not have a channel outbound receipt');
```

实际 `1 !== 0`。这是生产证据断言，不是可在修复后转绿的完整回归：历史收据必须保留，不能删除来绿化。
下一步须构造独立隔离的「渠道输入→Web 输入」可重复原生回归，再定位和修复；不能靠提示词要求禁止外发。
目前没有更改运行代码、渠道配置、权限、凭据、预算或历史，也没有撤回已经发送的消息。

## 修复与预定复验（保留上面的原始失败）

上述「尚未修复」是 09:53 现场状态。后续修复只涉及飞书 Adapter，不修改 Gateway/DSH 核心或 Telegram。
根因是 `agent/turn-stopping` 在无本轮回复目的地时，无条件用唯一绑定 route 兜底，绑定后的 Web 输入因此也被投递。
原生装配回归在修复前得到「期望一条，实际两条」；额外审批探针得到 cancelled 而不是下一原生 provider 的 unavailable，
证明 Web 审批详情也进入了飞书卡片。两项均已修复。未打开第二生产 Host，未增加模型可见内容、模型调用或持久 origin 库。

本轮 native inbox claimed 的外来输入会 veto 整轮自动出站，并清除 present 的当前渠道标记；发送前读取原生 Session
与 inbox 插入记录复核，不能把 AGENTS/策略注入等 user/message 上下文误当作新用户输入。审批在当前本地轮次交给下一
原生 provider；重载后尚未提交消息的来源不明窗口也不推断飞书接收方。原生 Schedule 续接与已存在的显式文件审批路径保留。
旧 dual-Workspace fixture 的普通 `source: user` followup 断言原先要求自动镜像，这正是错误语义；改为要求原生执行结束而不外发，
没有把它改装成 Schedule 来源来绕过检查。Telegram 的相似兜底不在本补丁内，不能由飞书结果宣称全渠道隔离。

已运行（固定 alpha.1）：

- `DSH_EVOLVE_DSH_SOURCE_DIR=<audited-source> DSH_FEISHU_TEST_NATIVE_FILES=1 pnpm exec vitest run --maxWorkers 1`
  （工作目录 packages/dsh-feishu）：29 文件 164 项通过，79.61 秒。含静态/配对切换、混合输入、Web 审批不出站、
  原生附件 20 个分支、Schedule 冷恢复与 dispatch 持久化窗口，以及包 add/dump/remove。SDK/模型为测试替身，不能代替实际飞书。
- `pnpm exec vitest run test/suite-native-plugin-contract.test.ts --maxWorkers 1`（packages/dsh-doctor）：24 项通过。
- 飞书 typecheck、`pnpm run check:docs`、`git diff --check` 通过，临时 DEBUG 探针已删除。
- canonical checkout fetch 后 origin/master 为 `ddefc45fbc7f8e46dd73185e68295696d1297887`，出现 alpha.2 标签；
  本轮不升级核心，继续固定支持的 `0d1f500` / alpha.1。该 checkout 无改动、无 exact tag；
  `pnpm install --frozen-lockfile && pnpm run build` 完整通过。alpha.2 尚未完成构建/兼容审计，不称当前支持版本为 latest。

部署前固定真实复验序列，均在原有 Session、模型和权限内：

1. F2 飞书：真正读取原有核对结果与缺失追加确认；预期明确未完成、无输出/附件，允许一条失败说明回复当前私聊。
2. F3 Web：同一两材料任务；预期两次读取、一成功一失败、无输出/附件，且不新增任何渠道文本收据。
3. F4 飞书：只回复固定标记「渠道仍可用」，不调用工具；预期一次回复，证明 Web veto 不粘连到未来渠道轮次。
4. F5 Web：只回复固定标记「仅在网页显示」，不调用工具；预期当前 Web 可见而飞书收据不变。

每次先核对完整输入再发送，一次提交；记录精确原生 turn、耗时和用量。旧 turn 27 收据必须保持不变。
生产只更新飞书包，保留旧包以便精确回退；回退会重新引入此缺陷，不能视为安全推荐。不更改 profile 策略、权限、凭据或历史。
当前尚未完成本节真实复验，不提前宣布问题关闭。

## 部署后真实复验结果（10:18–10:22）

修复提交 `b168624` 已推送并部署，唯一生产 Host PID 88390、仍只监听 127.0.0.1:3000。
仅飞书包切换到 channels-feishu pack `d5823ce9970136d472f2ba4a55c1e201285feee556df4e6f9625dd5a0f66d13f`；
安装 dist 与测试产物字节一致。演化/Web 包、原生权限、凭据与策略不变。实际完整 pack 的干净配置生命周期
`software-delivery-clean-profile-suite` 两项通过（41.79 秒），覆盖安装、启动、原生模拟工具、移除及历史读回。

| 固定任务 | 原生 turn / 工具 | 真实结果 | 请求 / token 总量 | 原生耗时 |
| --- | --- | --- | --- | --- |
| F2 飞书 | 28 / 两次 read | 一成功一缺失；明确未完成，无报告/附件；失败说明送达一次 | 2 / 48,624 | 13.054 秒 |
| F3 Web | 29 / 两次 read | 一成功一缺失；明确未完成，无报告/附件；无渠道收据 | 2 / 50,618 | 11.651 秒 |
| F4 飞书 | 30 / 无工具 | 私聊实际收到「渠道仍可用」一次 | 1 / 25,710 | 3.598 秒 |
| F5 Web | 31 / 无工具 | Web 显示「仅在网页显示」；无渠道收据，飞书界面不变 | 1 / 25,770 | 3.723 秒 |

四次均核对完整输入后仅提交一次，无重输/重发。F2 初次观察有界面延迟，未再次发送；随后实际客户端和原生记录
确认同一任务已完成。合计 6 次执行请求、32.026 秒（不含操作等待）、150,722 token：input 3,014、output 380、
cacheRead 147,328；费用未知。没有新增演化试验或调整预算。F1 原生精确记录补充为 10.757 秒、两次执行请求，
46,623 token（input 1,253 / output 186 / cacheRead 45,184）；原失败及消耗不抹去。

只读收据断言通过：部署前 24 条文本记录逐项保持不变（含 turn 27 误发），新增恰好 turn 28/30 两条，
均 delivered、attempts 1 且有关联回复；turn 29/31 零条。四份原任务文件 hash 不变，缺失输入和报告仍不存在，
附件账本及 cordis.patch.yml 与备份逐字节一致。

备份位于本机 `channel-origin-backup-20260918.OJBMuk`。最终扫描含 44 个历史文件，其中 42 个字节不变、两个压缩
Session 文件变化；不能把压缩文件当文本按行比较。经官方 SessionPersistence 解码：主会话旧 510 个事件与 header
完整保留，追加一次 end-seed 和四轮任务至 558；另一个旧三事件会话仅追加 end-seed，header/事件前缀完全一致。
未删改历史或凭据。核心构建期间曾短暂出现 Web 空白/未选会话，刷新并重选原会话后恢复；不宣称该现象已修复。

结论：本次真实「飞书→Web→飞书→Web」序列中的文本误发已修复并复验通过，多材料缺失输入路径没有伪造交付。
审批隔离仍是原生装配证据，不是实际审批卡全矩阵验收；Telegram 相似路径未修复。旧包保留可精确回退，
但回退会重新引入缺陷。本次没有证明 Skill 未见任务收益、未来启用/回滚或 Hermes 优势。
