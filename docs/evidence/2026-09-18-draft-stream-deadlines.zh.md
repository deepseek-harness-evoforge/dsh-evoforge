# 草稿持续输出被一分钟总时限截断：修复与部署验收

## 结论与非结论

以 `bdb74c8` 为起点，修复草稿辅助请求的确定性可靠性缺陷：即使原生流每15秒持续返回有效内容，
旧实现仍在60秒总时限取消，不能完成75秒响应。新实现保留60秒无新流事件限制，另设180秒总时限。
调用数、4000/2000输出上限、模型route、提示、预算及隔离校验不变，无自动重试或 Skill 启用。

此缺陷由受控流复现；它可能影响真实慢响应，但不能据此反推上一轮真实 `model-timeout` 的具体原因。
旧记录缺少流进度事实，不能区分当时无响应、持续生成或缺少结束信号。本轮不重发该请求，不声称真实模型草稿已成功。

## 诊断闭环

1. 原生入口 `nativeConversationDraftModel`，每15秒返回一段JSON，75秒返回成功finish。
   `pnpm exec vitest run test/conversation-skill-draft.test.ts -t 'continuously progressing'`：
   两个角色均失败，实际 `{ failure: 'model-timeout' }`，不是仅检查进程退出。
2. 排列并区分三种原因：固定总时限截断有效流、上游无新响应、流缺少结束信号。
   补充静默、部分响应后停顿、finish后挂起、持续输出达总时限、主动取消用例。
   修复前六项失败、一项取消用例通过；一次测试编辑的语法错误已修正，不计为产品失败证据。
3. 使用已支持 DSH 的 `idleWatchdog` 与 `deadline`，不引入自有定时服务或 Promise race。
   同一个稳定取消信号传入原生流，异常时等待 iterator.return 清理；对不响应取消的上游不宣称强制释放。
4. 新原因分别为 `model-idle-timeout` 和 `model-total-timeout`；旧 `model-timeout` 保留，不按新规则回填历史。
   每次已知usage、预留与dispatch marker保留，冷恢复/跨日不自动重发。Web中英分别显示两个原因及等待规则。

## 核心与边界

本轮 canonical `git fetch origin` 后，原检出仍 `5dda764ed3aa172535a7967b06ff95d9cbfe536a`，
`origin/master=ddefc45fbc7f8e46dd73185e68295696d1297887`，检出描述 `dsh-v0.1.5-alpha.1`。
实际支持核心仍为干净的 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720 / 0.1.6-alpha.1`，无精确tag。
复用当天该支持版本已完成的frozen install/full build证据，本轮没有再次构建或修改生产核心；不称其为最新上游。
复核了该版本 timeout 官方文档和实现，idle只统计等待next的时间，总deadline限制单次请求。
定时器是取消通知，不能在系统休眠或事件循环被阻塞时保证精确墙钟时限。

改动仅在既有草稿模块及其Web显示，没有新增服务、工具、模型可见组成、凭据、Workspace或权限入口。
新增失败原因由新读取器识别；旧程序不保证读取新原因，回退不得覆盖历史。停用仍通过撤回策略，保留读取器与记录。

## 测试与异常记录

- Host `conversation-skill-draft.test.ts`：35项通过，包括75秒持续输出、60秒静默和180秒总时限的假时钟检查。
  同时断言实际迭代器关闭、无残留定时器、已知用量保留、跨日不重发。
- `DSH_EVOLVE_DSH_SOURCE_DIR=<支持核心> pnpm exec vitest run test/conversation-message-feedback-native.e2e.test.ts test/conversation-skill-draft.test.ts test/conversation-message-feedback.test.ts test/config-contract.test.ts`：61项通过，零跳过。
- `DSH_EVOLVE_DSH_SOURCE_DIR=<支持核心> DSH_EVOLVE_SLOW_STREAM_TEST=1 pnpm exec vitest run test/conversation-message-feedback-native.e2e.test.ts -t slow-governance`：
  真实75秒wall-clock流，经native feedback、Job、LLM adapter、草稿、隔离trial和冷恢复，最终1项通过、6项因名称过滤未运行。
  这是受控适配器、零付费调用，不是Provider效果样本。该可选长测试不混入默认快速套件。
- 长测试首轮失败：12:24:34开始，超过测试120秒限制，实际总时长约161秒。
  `pmset -g log` 对应12:25:46 `Clamshell Sleep`、12:27:16 `DarkWake`，休眠发生在75秒响应结束前。
  该失败保留，不伪报首次通过；唤醒后相同运行时代码两次分别76.12秒、76.17秒通过，后一轮已移除临时诊断。
  12:06真实Provider超时早于此次休眠，不能用此环境原因解释它。
- Web `evolution-action.client.test.tsx`：先两项原因文案断言失败，修复后44项通过；Host/Web类型检查通过。
- 三Bundle正式pack构建通过；最终实际包 `packed-profile.e2e.test.ts` 1项通过、零跳过，覆盖官方安装/配置切换/
  原生反馈路径/dispose/remove/native历史回读。生产只更新演化与Web，未替换控制中心。
- `pnpm run check:docs`、`git diff --check`通过，临时 `DEBUG-draft-stream-20260918` 标记已移除。

## 生产部署与页面回读

保持同一DSH核心、Web profile、cwd、监听地址及无浏览器自动打开参数。仅官方 `plugin add --profile web` 更新两个包；
原PID97239正常退出并确认端口空闲后，启动唯一PID99343，监听 `127.0.0.1:3000`。
持久包目录为 `packs/draft-stream-282c48701aa1266f9ea604c7e63c4236cfdd01d48e7e0aaae699dae71e891674`。
演化tarball SHA256 `282c48701aa1266f9ea604c7e63c4236cfdd01d48e7e0aaae699dae71e891674`；
Web tarball `01329cb4ed58b4128efc2ae5a1d4947996b81b5dace98ef9eac9f29e5c0c6cf8`。
安装文件hash与仓库构建一致：Host `3a9fa3092bc52c9d34e4d552b60a0ca907d348a23f098deb0bb74ad015e204e2`，
Web `7487cba39b056abf0e73723a662c4c1fb73eb61ac4b482e6a1b98c013ad77dad`。

升级前私有备份保存profile、30个原生会话、三个学习账本和两个外发账本。通过原生只读API比较，
30个会话header和全部事件前缀相同、追加事件0；五个账本逐字节相同，profile策略也逐字节相同。
实际页面整页刷新同一客服验收会话，显示新3分钟/60秒规则，旧超时记录仍在，草稿2/2、对照0/24、0启用Skill。
没有新Provider请求、草稿、实验、外发、quota或retry grant；此前的三项真实任务不重跑、不改分。
新原因显示经过组件验证，生产没有人为制造新的失败记录来展示新文案。

本轮完成持续响应的取消策略修复与部署；真实反馈成功起草、独立未见收益、启用/精确回滚及Hermes比较仍未完成。
