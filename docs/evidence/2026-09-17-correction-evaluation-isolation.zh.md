# 评测会话不再生成普通纠正后台任务

日期：2026-09-17。基于 `54f8db9`。本轮是无付费修复与部署，不是 Skill 效果证明。

## 问题与复现

普通纠正监听器收到所有原生 completed turn，在检查实际消息来源前就创建原生 Job。
八分支草稿评测因此额外生成八个纠正检查任务；它们没有产生额外模型调用，但会占用后台任务并可能在
评测 Session 已释放时形成无意义的来源读取失败。不能把这些合成评测输入当成用户的独立纠正。

在现有原生无 Goal 端到端夹具中，增加“评测前后纠正 Job 数不变”断言，四种路径均失败：期望 2，实际 10。
路径分别是普通实验、草稿恢复、实验初始化恢复和语义评测。对同一夹具实施筛选后四种路径全部通过。
这证明任务生成路径，不证明先前线上每次警告的唯一原因。

## 改动和边界

`dsh-evolve` 在创建纠正 Job 前、实际开始读取来源前，查询自己的持久评测计划，排除精确匹配的原生 Session id。
启动时显式回读走同一筛选。归属来自已校验的历史计划，策略撤回不移除它；不依赖 id 前缀，不跳过仅名称相似的会话。
归属账本不可用时停止并警告；普通会话缺失等真实错误仍保留 failed/inspection-unavailable。

仅用现有 DSH Storage、Session event、Jobs 和 Cordis 生命周期；没有新服务、数据库、后台循环、权限或模型请求。
普通请求的提示、工具、Skill 与缓存组成不变；不改会话或已有评测账本，无新 schema。
卸载沿用原有取消/等待/解绑语义，原生历史保留；可回退上一演化包，但回退会恢复多余任务问题。
这不实现 Skill 启用、精确 Generation 回滚或泛化验收。

## 实际验证

官方 checkout 再次 fetch 后 HEAD 与 origin/master 都是 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`，干净，
版本 `0.1.6-alpha.1`，HEAD 无精确 tag；依赖及构建产物在位。沿用 9 月 15 日已通过的 frozen install/官方全量 build，
本轮没有重装依赖或重新全量构建 DSH。

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=<audited-checkout> pnpm --filter dsh-evolve exec vitest run \
  test/conversation-correction-native.e2e.test.ts test/conversation-draft-trial-store.test.ts \
  test/conversation-correction-intake.test.ts --maxWorkers 1
pnpm --filter dsh-evolve exec tsc --noEmit -p tsconfig.test.json
pnpm run pack:suite -- --suite product --out <private-staging>
DSH_EVOLVE_DSH_SOURCE_DIR=<audited-checkout> DSH_EVOLVE_PACK_DIR=<pack> \
  pnpm --filter dsh-evolve exec vitest run test/packed-profile.e2e.test.ts --maxWorkers 1
pnpm run check:docs
git diff --check
```

- 三文件 32 项通过；类型、文档与 diff 检查通过，七个 product 包构建打包通过。
- 实际原生评测八分支不再新增纠正 Job、没有纠正警告，普通纠正仍分类、可取消、冷恢复不重复调用。
- 冷启动同时回读用户会话、八个评测会话和一个不存在的普通会话：只有两个 Job，分别 completed/failed；
  缺失来源保留一项警告，模型调用没有增加。精确身份、相似名称不匹配、策略撤回后归属及写入失败拒绝查询均覆盖。
- 实际 tarball 的演化 Host/Web/Control 三 Bundle 干净配置 add/dump/boot/禁用启用/dispose/remove/原生会话读回通过。
  该生命周期夹具采用无密钥适配器，不覆盖真实付费请求或整个渠道套件。

## 现用部署

持久 pack：`2aac882c4c6d75903a49249e07f25bfbceddb72a27b558fe38d926b291b56a36`，七个产物 hash 全部核对。
只通过官方 CLI 更新 `dsh-evolve`，其他依赖与 profile 策略不变；停止 PID 41806 后启动 PID 43261，
只有后者监听 `127.0.0.1:3000`。没有第二持久 Host。

升级前备份原生 sessions、profile 和十个 EvoForge 账本；升级后 42 个 Session 文件及十个账本共 52 文件逐字节一致，
策略文件逐字节一致。未清空历史、配额或恢复授权，未新增真实付费模型请求。
原生页面整页刷新及控制台刷新成功，原会话仍 22 轮/47 步、原模型权限不变；旧双方字面 0/4、旧失败根和 48/24
保守预算保留，截图确认失败不是成功。线上没有重跑八分支；新筛选的执行证明来自上述原生无密钥夹具。

## 未完成

真实新纠正→独立未见任务效果→未来会话启用及精确回滚仍未闭合；语义评测仍默认关闭。
额外真实试点预算尚待用户确认，还须遵守日配额，不通过清零旧记录或复制 Workspace 绕过。
同条件 Hermes 比较未完成，本轮不作优越性声明。
