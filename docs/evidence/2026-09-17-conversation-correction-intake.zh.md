# 普通聊天纠正识别入口：真实部署验收

## 范围与预先固定的判据

此增量把原生普通聊天中的纠正转成无原文、未验证的线索；不创建 Goal、不修改 Skill、不授予 Candidate 或评测资格。
DSH 唯一核心为 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` / `0.1.6-alpha.1`，本轮 fetch 后与 origin/master 相同，
工作树干净；frozen install 与完整上游 build 通过。没有修改 DSH。

在首次真实识别调用之前固定：只对当前验收 Workspace 启用每天最多 4 次辅助调用，并只回看显式指定会话的最后两个
completed turn。既有 E2、E3 都是对上一份阅读版交付的真实呈现纠正，预期 `correction/presentation`；它们属于同一工作
episode，不能算两个独立训练样本。随后发送一条明确“新增要求（不是纠错）”的标题请求，预期不是 correction。
不以事后调整判据掩盖失败。所有调用使用来源会话已有的原生 provider/model；费用无可靠计价时只报告 token。

## 已完成的本地与组装验证

- 六文件 49 项定向测试通过，含原生 Context、Session 持久化、LLMRuntime、Jobs 与 Storage 的组装测试。
  命令：在 dsh-evolve 中设置 `DSH_EVOLVE_DSH_SOURCE_DIR` 为上述审计源码，运行
  `pnpm exec vitest run test/conversation-correction-intake.test.ts test/conversation-correction-native.e2e.test.ts test/config-contract.test.ts test/evolution-control-plane.test.ts test/evolution-remote.test.ts test/feedback-signal-monitor.test.ts --maxWorkers 1`。
  原生测试缺少该环境变量时会跳过，本次有设置且实际通过。
- 四类证据边界：没有 Goal 的纠正可识别；不把合成消息当人类纠正；相同来源重启不重发；取消/未完成模型响应不记成功。
- Web 两文件 32 项测试、Host/Web 类型检查与构建通过。显式 finish 缺失、重复或其后继续输出的测试先红后绿。
- clean-profile 两项生命周期测试通过；官方 product 隔离安装与清单校验通过。
  持久 pack：`f6f02678810764cc95976b1cefaf81962a00d86faf14259df83bdd7d1507ba0e`。
- `pnpm run check:docs`、`pnpm run check:ci`、`git diff --check` 通过。这不是全仓测试或完整发布声明。

## 真实运行

待部署后填写实际结果；目前不得把上述 fixture 结果当作真实模型正确率。

## 已知限制

识别是模型解释，不证明纠正正确、修复有效、Skill 归因或独立样本。当前不会自动进入 Candidate 管线。
默认关闭，撤回策略取消自有工作但不删除原生历史或已有账本；记录达到上限停止，不删除幂等事实换取重试。
控制面只投影原生账本；普通 Agent 会话组成保持不变，但启用策略会增加有限辅助模型调用。
