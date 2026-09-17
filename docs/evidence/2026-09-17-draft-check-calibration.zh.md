# 草稿字面检查校准与原生配置生命周期（2026-09-17）

## 结果与范围

在 `0bf512e` 的真实对照发现字面断言脆弱之后，增加未来材料的替代表达校准入口，并明确现有得分的含义。
这不是对旧试验改分，也不是新的独立效果实验。旧实验仍是 baseline 0/4、draft 0/4、可比 4/4、加载草稿 2/4、
10 次请求，结论仍为这组固定断言下未观察到改善。未新增付费模型调用，未启用草稿。

- 新治理材料须给出第二个正确答案；两个正例均通过已提出的固定断言，负例失败。允许唯一指定输出相同。
- 校准失败在 proposer 前停止，不自动重抽或改写断言；保持原有两次草稿预算政策与输出上限。
- 新试验遇到旧材料缺失替代答案或替代答案不通过时，写入 `blocked/evaluator-unqualified`，预留为零。
  不调用原生执行器，不产生试验 Session；跨日、重启和初始化恢复授权均不能重新启动该记录。
- 旧材料、已结束试验及失败根记录可读且不改写。Web 明确显示“字面断言通过”，不将其解释成任务完成率。
- 执行、测试作者与 proposer 的现有隔离保持；替代答案同样不进入 proposer、试验输入或 Web projection。

本次不新增 service、scheduler、数据库、工具、权限或自动晋升入口。现有 Session 模型组成不变；仅未来治理请求
增加静态字段要求。校准是有限正反例自洽检查，仍不证明答案语义正确、任务真实完成、独立样本规模或泛化。

## 固定原生版本

再次 fetch 官方 checkout 后 HEAD 与 `origin/master` 均为 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`，
工作树干净，版本 `0.1.6-alpha.1`，没有恰好指向 HEAD 的 tag。依赖和官方 CLI 构建产物存在；沿用
[该 revision 已通过的 frozen install / 官方 build 审计](../research/dsh-latest-audit-2026-09-15.zh.md)。
本轮未重新执行上游全量构建，未修改 DSH。新增干净配置安装与运行证据如下，不把历史 build 当成本轮重跑。

## 实际命令与证据等级

`DSH_EVOLVE_DSH_SOURCE_DIR` 指向上述官方 checkout；`DSH_EVOLVE_PACK_DIR` 指向本轮已构建 product pack。

```sh
DSH_SOURCE_ROOT=<audited-checkout> pnpm run generate:typert
pnpm run pack:suite -- --suite product --out <private-staging>
DSH_EVOLVE_DSH_SOURCE_DIR=<audited-checkout> DSH_EVOLVE_PACK_DIR=<pack> \
  pnpm --filter dsh-evolve exec vitest run \
  test/conversation-skill-draft.test.ts test/conversation-draft-trial-store.test.ts \
  test/conversation-draft-trial-guard.test.ts test/conversation-correction-native.e2e.test.ts \
  test/packed-profile.e2e.test.ts
pnpm --filter dsh-evolve-web exec vitest run test/package-contract.test.ts test/evolution-action.client.test.tsx
pnpm --filter dsh-evolve exec tsc --noEmit -p tsconfig.test.json
pnpm --filter dsh-evolve-web exec tsc --noEmit -p tsconfig.test.json
pnpm run check:docs
git diff --check
```

- product 七个包构建、打包通过；Typert 使用固定 revision 官方生成器，无手工修改生成协议。
- Host 五文件 48 项通过，含原生 Jobs 的三种对照/恢复组合、替代答案拒绝、旧材料读取、零预留阻断、并发/跨日/冷恢复。
  原入口 RED 测试观察到不合格材料仍预留 24；实现后相同断言通过。
- Web 两文件 41 项通过；覆盖阻断状态无得分、无启用按钮，及已有结果文案。
- 两包测试类型检查、文档和 diff 检查通过。这不是仓库全套测试或真实模型效果证明。

新增 opt-in `packed-profile.e2e.test.ts` 使用独立 `DSH_HOME`，不覆盖 `HOME`，不复制用户凭据，安装脚本关闭：

1. 官方 CLI 从实际 tarball 安装 `dsh-evolve`、`dsh-evolve-web`、`dsh-control-center`，检查配置中每行恰好一次。
2. 官方 AppBoot/Loader 按新 profile 启动，loopback 临时端口；关闭自动打开浏览器，测试不输出认证 URL。
3. 原生 Loader 禁用演化插件，等待完整卸载后重新启用，验证控制服务恢复。
4. 原生注册 Workspace、挂载官方 standard preset，使用无密钥模拟 adapter 完成一个原生 turn 和原生标题请求。
5. dispose 后用官方 CLI 卸载三个 Bundle，配置中不再出现其行；原生 DSH 重启，演化服务和 Typert 包消失。
6. 通过官方 SessionPersistence `open/read/close` 读回完整原始事件并逐项相等；关闭全部测试 Host、清理其临时目录。

初次 probe 未等待 Loader 卸载完成即重启，造成服务未恢复；源码与最小观测表明当时仍有一个生命周期任务。
等待 `loader.await()` 后正常，未修改运行时。测试还须使用正式 Workspace/preset、void setup 返回及等待原生标题事件，
不能把程序化 Agent 默认继承用户配置或“主 turn idle”等同于所有后台原生事件已完成。上述都是本轮验收 fixture 修正，
不是已发现并修复的产品缺陷。测试证明三 Bundle 无密钥组合生命周期，不证明全部产品套件或在途付费请求的重载。

## 现用部署与保全

持久 product pack 内容地址：`04c1c4ff9d4b8aadaff5d6e4548221e71dec3f20a81cb872abf8b2e78c6dccc3`。
现用 profile 只安装其中演化 Host/Web 两包，其他插件不变。先停止旧 PID，再官方 add/dump，启动单一现用 DSH Host；
loopback 3000 只有新 PID 38819 监听。没有第二个常驻服务。

真实原生页面整页重载并点击刷新，原会话仍是 22 轮 47 步，模型/权限不变；显示历史恢复实验 8/8、字面断言双方 0/4、
10 次请求与 9357/1567 token，旧失败根仍显示未完成且不自动重跑。窄视口截图检查通过：得分解释、失败记录均可读。
今日计数 48/24 保留原先临时授权产生的两个预留，不为好看而清零或扩预算。

部署前后 42 个原生 Session 文件与 10 个 EvoForge 存储文件逐字节相同，profile 策略文件也逐字节相同。
备份覆盖这些权威历史与 profile 文件；一个不可读的派生 projection cache 未完整复制，原地保留，未改权限，
因此不宣称备份了整个 DSH Home。测试没有往真实账本注入合成 blocked 行；该新失败状态由 store/executor 与组件测试证明，
现用浏览器证明历史失败路径与新文案，而非凭空声称现场触发了新阻断。

上一 pack 保留。当前账本未新增字段/行，可回到上一版本；将来出现新校准材料或 blocked 行后，旧代码的严格 schema
不保证读取新记录，不能靠删除历史实现代码降级。这与未来 Skill Generation 的精确回滚是不同边界。

## 未完成项

仍需真正独立、语义稳健的评测治理与未来未见任务上的效果证据；本次两正例不能替代它们。
未完成普通纠正草稿的未来 Session 启用/精确回滚验收，也未完成同条件 Hermes 对比；不声明学会、替代能力或完整发布。
