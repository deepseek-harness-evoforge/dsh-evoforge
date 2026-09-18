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
