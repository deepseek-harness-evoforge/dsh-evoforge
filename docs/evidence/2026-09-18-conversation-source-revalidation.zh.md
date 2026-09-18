# 普通草稿来源复核与生产恢复验收

## 结果与边界

2026-09-18，在 `fb7e64f` 基础上补齐草稿起草和对照检查期间的来源复核。来源失效或无法读取时停止后续调用，
不产出新的草稿或比较结论；保留已知用量、dispatch marker、分支结果与预算预留。没有重抽题、自动重试或启用 Skill。

这是已有聊天纠正管线的安全增量，不是消息反馈直接生成草稿的完整交付，更不是未见任务收益或 Hermes 替代证明。
可编辑消息反馈仍需独立的真实来源身份，不能伪造为已经调用过识别模型的 CorrectionRecord。

## 权威、生命周期和成本

- 仍由单一 DSH Host 的 SessionPersistence、Workspace、Jobs、LLM 和 Storage Domain 承担权威。
- 起草监控器及评测监控器的检查会重新读取固定原生前缀，比较完整输入、纠正记录和 Workspace；评测还比较草稿快照。
- 检查支持异步读取；失败或拒绝不被当成真值。读取使用现有原生 reader 的 deadline 和句柄释放机制。
- 在角色/裁判请求之前和返回之后、执行分支之后，以及提交最终比较之前复核；dispatch marker 写入之后还复核一次。
- 无新 Tool、Skill、system prompt、识别模型请求、配置或日预算；新增的是原生读取开销，未单独测量其延迟。
- 卸载仍取消并等待自有 Jobs；来源检查取消后不能授权更多请求。已结束历史结果不重写，未知消耗不按零。
- 这不是与原生 Session 存储事务合并的原子锁；不会宣称能撤回已发送请求或在底层不响应取消时强行终止它。

## 上游与本地验证

本轮官方 fetch 后 `origin/master=ddefc45fbc7f8e46dd73185e68295696d1297887`。支持和生产仍固定
`0.1.6-alpha.1 / 0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`，支持 checkout clean，无 exact tag。
复用当天同一支持 revision 已通过的 frozen install 和完整 build；本轮没有重建运行中核心或把支持版本称为 latest。

命令和结果：

1. `pnpm exec vitest run test/conversation-skill-draft.test.ts test/conversation-draft-trial-store.test.ts`：
   修复前五项新回归失败；修复后 42 项通过。覆盖初始 false/reject、两个起草角色调用中失效、
   保留用量、冷重启不重试，以及异步裁判来源失效。
2. 指定上述官方源码目录运行 `test/conversation-draft-trial-guard.test.ts` 和
   `test/conversation-correction-native.e2e.test.ts`：17 项通过。真实原生 Agent/Loop/Skill/Tool，受控模型；
   第一或第八分支结束时撤回来源均保持 uncertain、无比较结论、无遗留 Agent。稳定来源仍完成八分支且不把相同结果称为改善。
3. `pnpm run typecheck`：主代码与测试 TypeScript 均通过。
4. 三个 Bundle 的 `pnpm pack`：构建、Typert 与产物检查通过。
5. 设置 `DSH_EVOLVE_DSH_SOURCE_DIR`、`DSH_EVOLVE_PACK_DIR` 后运行 `test/packed-profile.e2e.test.ts`：
   一项通过，非跳过；隔离配置的官方 add/dump/boot、disable/reload/dispose、原生对话、remove 和原生历史回读通过。
   该组装测试没有真实付费 Provider，不能代替效果验收。
6. `pnpm run check:docs`、`git diff --check`：通过。

## 生产部署与实际 Web

只通过官方 plugin add 替换 `dsh-evolve`。三个测试 tarball 保存在持久目录
`packs/source-check-b3f08928649a20cfc8be1010a6df1a67af7596c8ea7e1b5ecdbb3177c6dd903e`；
演化 tarball SHA-256 即该目录后缀。已安装演化代码与仓库构建逐字节相同，SHA-256 为
`e2f01155f2b4d13917759a610eb8f8eeb16cbd5012b140712b53a61dc03d032f`。

安装退出 0，仍有 Host 提供的 peer dependency 提示；没有为消除提示安装第二份核心。
profile 依赖仅演化包路径变化，`cordis.patch.yml` 字节不变，Web/飞书包未替换。
备份保留原配置、lockfile、Session 文件及三个学习账本；回退只重新安装备份记录的旧包，不覆盖用户历史。

确认后台检查为 `inspection-finished` 后关闭 PID 92223；确认旧进程及监听消失后启动 PID 93643。
`lsof` 验证唯一监听 `127.0.0.1:3000`。页面刷新恢复同一只读 Session，旧草稿、失败和 0/4 历史结果仍可见。

固定生产冒烟输入：只读取已有对账产物 `核对结果.json`，报告订单数、可确认总额、取消订单与冲突内容；
明确禁止修改文件、命令、联网、飞书发送、Skill、Goal 和子代理。发送前核对完整输入，未改变只读权限。

- 实际页面返回：4 单、CNY 197.5、取消 O-103、冲突 O-104，原数量 5，待确认数量 6/7。
- 原生 Session `session-f9395033-900a-4138-aba8-52d8f6d634ef` 的 turn 2、seq 40–55 为 completed；
  两条 assistant 记录、一次 `read`，没有其他工具调用。页面显示约 9 秒、16.9K token；费用未测量。
- 备份中该 Session 的全部事件前缀仍完全相同；新的正常对话追加历史，不宣称整个文件字节不变。
- 三个学习账本与升级前备份字节相同；没有新草稿、实验或重评。
- 对账 JSON 和说明文件仍保持原 SHA-256：`54c148d56339c14bb623548132cf5e22142b7944b3d1eab3490146d444465645`
  与 `2766d14785eb5c5a6768cc0fa19eda72d459a45507b14a824e92897da6226748`。

生产只读任务证明升级后基本路径可用，不检验新增中途失效分支；那些分支由上述受控原生回归覆盖。
已有对账任务复用不是新独立样本。此次没有新增真实飞书验收或配对 Hermes 实验。
