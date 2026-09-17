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

实现提交 `66d1f1f` 已推送 origin/main。仅从上述校验过的 product pack 安装 dsh-evolve 与 dsh-evolve-web，
在原 profile 加一条精确 evolution override，保留 bundle 的 cacheRoot；其他包依赖不变。
安装前冷备份 profile 和 sessions，22 个历史文件逐字节核对不变。附加 storages 备份遇到一个原生
session_projcache 文件 EACCES；没有改变该文件权限，备份不能称为完整存储备份。

真实原生模型 gpt/gpt-5.6-sol 结果：

| 输入 | 实际分类 | 输入 token | 输出 token | 判据 |
|---|---|---:|---:|---|
| 已有飞书 E2（turn 20） | correction / presentation | 652 | 183 | 通过 |
| 已有飞书 E3（turn 21） | correction / presentation | 679 | 139 | 通过 |
| Web 新增标题要求（turn 22） | changed-requirement / instruction-following | 483 | 71 | 通过：不是纠正 |

合计 3 次辅助请求，输入 1,814、输出 393 token；provider 未提供 cache-read/cache-write 数值，不推断零缓存或货币成本。
这三项是窄样本验收，不是泛化正确率。标题任务本身另有一次原生 Agent 请求，Web 显示约 15.3K token、3 秒，
真实回复“活动行动简报”，无工具调用。该主任务消耗不包含在辅助识别合计里。

真实原生控制台刷新显示 2 条待核对纠正、0 正在识别、0 结果不明、今日预算 3/4；普通回答负反馈仍为 0。
531px 窄屏截图检查了卡片顶部和滚动后底部，字段换行正常。断开唯一 Host 后点击刷新，出现读取失败并保留旧计数；
重启同一 profile 后手动刷新恢复，权限保持完全访问，没有另建 Host 或 Session。

冷重启后纠正账本逐字节不变：三条记录仍 classified、modelCalls 各 1，未追加识别预留或重复请求。
最初用压缩 Session 文件哈希验证得到不同，进一步用官方 zstd frame reader 核查：DSH 正常退出追加了原生
`session/end-seed`（seq 417）；最后完成的仍是 turn 22，前两个纠正及新增要求的来源重放没有冲突。
因此只声明来源和任务历史保留，不声明压缩 Session 整文件在运行与退出间逐字节不变。
五个 Gateway 持久文件与冷备份逐字节一致，含 pairing、ingress、outbound 与 file outbound；本次没有新增渠道发送或配对变更。

## 已知限制

识别是模型解释，不证明纠正正确、修复有效、Skill 归因或独立样本。当前不会自动进入 Candidate 管线。
默认关闭，撤回策略取消自有工作但不删除原生历史或已有账本；记录达到上限停止，不删除幂等事实换取重试。
控制面只投影原生账本；普通 Agent 会话组成保持不变，但启用策略会增加有限辅助模型调用。
