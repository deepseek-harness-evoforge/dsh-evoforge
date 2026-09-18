# Web 订单核对、产物与恢复验收

日期：2026-09-18。以下输入与验收在真实任务发送前固定。本轮是普通任务效果测试，不是新 Skill 评测或 Hermes 比较。

## 固定任务

在原有 Web 会话读取两份专用虚构 JSON：订单表与变更表。仅写同目录下 `核对结果.json` 和 `核对说明.md`，
回读核对并在 Web 展示；不能修改输入、运行命令、联网、创建 Goal/子智能体、调用 Skill 或向任何渠道发消息。

订单为 O-101（便签，3×12.50，已确认）、O-102（帆布袋，2×40，待确认）、O-103（支架，1×99，已确认）、
O-104（马克笔，5×8，已确认）。变更：O-102 确认数量为 4；O-103 取消；O-104 有两条冲突数量 6/7，均未确认；
O-101 的数量 3 重复确认两次。同一订单不能因重复确认而重复计数；不能按记录时间将未确认变更当成生效。

金标准在发送前固定：

1. 输出恰好 O-101 至 O-104 四个唯一订单，按 id 排序，不产生新订单或丢失取消项。
2. O-101：数量 3，单价 12.5，小计 37.5，状态 confirmed；重复确认不重复累计。
3. O-102：数量 4，单价 40，小计 160，状态 confirmed；采用已确认的更新。
4. O-103：状态 cancelled，保留订单但不计入已确认合计。
5. O-104：状态 conflict，保留原数量 5 与未确认候选 [6,7]；有效数量和小计为 null，不自行选最新记录。
6. confirmedTotal 为 197.5，currency 为 CNY；不能把冲突或取消项加入合计，不能把 unknown/null 写为 0。
7. 每个订单的 sourceRefs 能定位输入文件和对应行 id；说明解释去重、取消、冲突及合计口径。
8. 两份输出确实存在并可回读，JSON 能解析；两输入字节不变。Web 展示不应新增飞书出站或附件交付。

只发送一次，失败如实记录；额外纠正另计，不回填初次成功。预定后续检查只读回同一结果，不重新生成或交付。
记录模型/权限、完成状态、工具和请求数、用量与耗时；费用没有可靠计价时保持未知。

## 结果

R1 一次发送，零额外纠正，八项标准通过。O-103 保留原始小计 99，但未加入 confirmedTotal；O-104 的 quantity/subtotal
确实是 JSON null，候选 6/7 和原数量 5 保留，全部来源引用可定位。说明文件逐项核验，没有宽表格；实际 Web 侧栏
预览可读。不能由一次成功推断整体正确率或已学会。

当前 main `0484be9`，运行的演化包为 `00e7a5b`，DSH 固定 `0.1.6-alpha.1` / `0d1f500`，唯一 Host PID 43261。
原会话、provider gpt/model gpt-5.6-sol、完全访问保持不变。原生 turn 23 在 419–456 seq 完整记录，53007 ms、五步，
七个工具调用：两输入 read、两输出 write、两输出 read 和一次同时展示两文件的 present；没有命令、Skill、Goal、
子智能体或审批事件。原生按目录规则自动注入仓库 AGENTS.md，不是任务主动调用读取其他文件。

五个 assistant 请求的 stream usage 总计 totalTokens 93419（UI 93.4K），inputTokens 20651、outputTokens 1728。
四个请求记录 cacheReadTokens，共 71040；首请求该字段缺席，不把缺失字段伪称已测零值。费用未知，token 不是账单。
现用授权纠正策略另调用一次，判为 changed-requirement，没有新草稿或新评测；该辅助用量不混入上述任务数字。

两输入 SHA-256：

- 订单.json：`a67124c46a2c9666cdfec16759d777d403c355dc72f74d67bd6b2bc73b7f42b9`
- 变更.json：`159b8b5619582b3ef364c84c44bc652c78e0c40b84beaaf2fbeeee1614a70095`

两输出 SHA-256：

- 核对结果.json：`54c148d56339c14bb623548132cf5e22142b7944b3d1eab3490146d444465645`
- 核对说明.md：`2766d14785eb5c5a6768cc0fa19eda72d459a45507b14a824e92897da6226748`

JSON 独立断言、四文件目录范围和输入前后 hash 全部通过；原生 SessionPersistence 使用只读 open/read/close 取证，
没有直接改写历史。Gateway 普通出站及文件出站两份账本 hash 与发送前相同，Web 展示没有变成渠道外发。

## 预定 R2 冷恢复检查

保留原数据与配置，停止已确认空闲的唯一 Host，再启动同一 profile。回到原 Web 会话，仅要求实际读取刚才的
两份输出，回答唯一订单数、confirmedTotal、取消订单 id、冲突订单 id/原数量/候选数量/有效数量；不重述具体答案，
不允许写文件、重新展示/外发、命令、联网、Skill、Goal 或子智能体。
标准：实际两次 read，4 / CNY 197.5 / O-103 / O-104、5、[6,7]、null；四文件 hash 不变，无新增出站。
这是同一产物的恢复检查，不是第二份独立质量样本，也不是新的 Skill 泛化样本。

R2 已通过：原生 turn 24 completed，两次 read、两次模型请求，10550 ms；回答为 4 / 197.5 CNY / O-103 /
O-104、5、6/7、null，与标准一致。totalTokens 42344（UI 42.3K）、inputTokens 1982、outputTokens 170、cacheReadTokens
40192。没有重新写文件或展示附件。重启前 457 条原生事件前缀完全一致，重启只追加 session/end-seed；其他 51 个
历史文件逐字节不变，策略不变。新唯一 Host PID 81000，旧进程已退出。

## 预定 R3 飞书接续 Web 结果

在同一已配对的 DSH 私聊发一条只读请求：不重述路径或答案，要求读取刚才 Web 的结构化订单结果，回答确认合计与
仍待确认的冲突，不写文件或重发附件。标准为实际读取 R1 的核对结果.json、回答 197.5 CNY 与 O-104 的 6/7 冲突，
仅当前私聊新增一次文本回复，文件出站账本及四文件不变。此项证明已绑定的同会话渠道接续，不是陌生渠道授权或泛化。

首次原生客户端输入操作后未核对草稿就发送，实际消息丢失了大部分中文，只剩标记、英文与标点。平台气泡和 DSH
收到的请求均残缺；这是验收输入无效，不把它计入完整 R3 的模型质量分数。助手明确要求补全，没有调用工具或冒充
完成。该次 turn 25 completed 只表示回复已结束，不表示订单回读成功：6623 ms、一次请求、totalTokens 21950、
inputTokens 221、outputTokens 97、cacheReadTokens 21632，保留在总体用量中。

改用原生输入框 setValue，并在发送前核对完整可访问性文本后，发送同一预定请求。未改变材料、金标准、模型或权限，
这次人工重新输入计一次干预。尚未诊断首次文字丢失的底层原因，不能归咎于 DSH 或飞书的普通人工输入。

有效 R3 通过：原生 turn 26 completed，只有一次 read，读取的正是 R1 核对结果.json；两次请求、8163 ms。
totalTokens 44705、inputTokens 967、outputTokens 90、cacheReadTokens 43648。飞书实际气泡回答 197.5 CNY，
O-104 原数量 5、候选 6/7；截图确认可读。无新增附件，两条文本回执（残缺输入回复及有效回复）分别 delivered、attempts=1，
旧出站记录保持相同。R3 后四文件 hash 仍与 R1 完全相同。

## 本轮总计与边界

- R1 首次任务八项通过、零纠错；R2 只读恢复通过；R3 有效输入通过，但计一次输入重录干预，不能声称全程零干预。
- 三个有效任务加残缺输入共十个原生执行请求、78343 ms（不含操作等待），totalTokens 202418。
- 现用纠正策略在四个 turn 后另调用四次，已记录 inputTokens 2321、outputTokens 789；全部 classified，分别为
  changed-requirement、changed-requirement、unrelated、changed-requirement。没有新草稿、评测或 Skill 变更。
- 没有调整模型、原生完全访问、付费策略、语义评测或日配额；普通任务与现有已授权纠正策略的调用不依赖另行批准
  “60 次”试点。不能把本轮 task/渠道证据当成普通草稿泛化或 Hermes 比较。
- 费用未知；同一长会话上下文、缓存与平台条件未做对照，不据此宣称高效或低成本。
- 本轮未更改运行代码，无需重新打包部署；实际单 Host 冷恢复已验证。文档检查与 diff 检查作为证据发布前检查，
  不替代上述真实任务结果。

## 可重建的虚构输入

订单.json：

```json
{
  "currency": "CNY",
  "orders": [
    {"id": "O-101", "item": "便签", "quantity": 3, "unitPrice": 12.5, "status": "confirmed"},
    {"id": "O-102", "item": "帆布袋", "quantity": 2, "unitPrice": 40, "status": "pending"},
    {"id": "O-103", "item": "支架", "quantity": 1, "unitPrice": 99, "status": "confirmed"},
    {"id": "O-104", "item": "马克笔", "quantity": 5, "unitPrice": 8, "status": "confirmed"}
  ]
}
```

变更.json：

```json
{
  "updates": [
    {"id": "U-1", "orderId": "O-102", "quantity": 4, "confirmed": true},
    {"id": "U-2", "orderId": "O-103", "action": "cancel", "confirmed": true},
    {"id": "U-3", "orderId": "O-104", "quantity": 6, "confirmed": false, "recordedAt": "2026-09-17T09:00:00+08:00"},
    {"id": "U-4", "orderId": "O-104", "quantity": 7, "confirmed": false, "recordedAt": "2026-09-17T10:00:00+08:00"},
    {"id": "U-5", "orderId": "O-101", "quantity": 3, "confirmed": true},
    {"id": "U-6", "orderId": "O-101", "quantity": 3, "confirmed": true}
  ]
}
```
