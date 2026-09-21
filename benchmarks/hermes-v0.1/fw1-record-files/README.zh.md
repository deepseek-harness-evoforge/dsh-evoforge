# FW1：固定记录文件的 Hermes 对照

维护者验收工具，不是可安装的 EvoForge 能力或第二个生产服务。
在第一次 Hermes 评测请求之前固定本协议，沿用
[2026-09-22 的同一组封存任务与全部 DSH 结果](../../../docs/evidence/2026-09-22-file-workflow-real-comparison.zh.md)。
DSH 原能力与草稿均4/4，草稿没有改善；不能重新抽题、重评、改答案或据此启用。

## 比较范围

- 固定 Hermes `29d0cc2602e01943ab300c0382fc9d97efb376da`，原生 `AIAgent.run_conversation`。
  使用该提交的原锁文件安装；不修改核心、不替换模型返回值。原生工具和系统提示保持各自实现。
- 模型、OpenAI-compatible endpoint、凭据来源与 DSH 的 `gpt/gpt-5.6-sol` 相同。
  启动器只通过官方 DSH CredentialProvider 解析现有引用，以匿名管道送入单个测试子进程；不写 Key、环境文件或配置密钥。
- h1、h2、r1、r2 固定顺序，一题一个全新隔离 `HERMES_HOME`，无历史记忆或附加 Skill。
  每题最多12个实际 API 请求、每次4000输出token、600秒。无自动应用层重试，不重跑有结果的题。
- 输入从原封存 DSH 计划重建并检查 hash；模型只收到任务和自己的输入，不收到期望、DSH答案或草稿。
  Hermes 不复用 DSH 的草稿；本阶段测 Hermes 原能力，不声称测完 Hermes 自我学习。
- 相同工作目录；只可读取本题声明输入与结果、写改本题 result.json。模型无命令、网络、输入修改、目录外读写、
  Skill写入、子代理或权限提升。通过原生 `pre_tool_call` 插件实施，插件自己不计算或修正答案。
- DSH 的 read/write/edit 对应 Hermes 的 read_file/write_file/patch（单文件替换）。
  Hermes 的 search_files/skill_manage 不在可达范围内；空 Skill 目录的列举/读取保留原生行为。

## 验收与差异

共同主指标是：任务完成状态、真实结果文件的 JSON 类型/事实、输入未变、完整读取、实际写入和完整回读。
采用原封存 JSON oracle，允许空白和键顺序不同，拒绝额外/缺失键；执行完成与文件事实分开记录。
还记录全部实际请求/用量、工具错误、越界、人工干预、墙钟时间与原始结果，费用未知。

Hermes 没有 DSH 的原生 present 工具：任务中仅将该交付句换成“在最终回复中用相对路径指向该文件”。
不添加一个冒充 Hermes 原生展示的工具，也不因缺少 present 判其共同事实指标失败。
DSH 的原生展示与 Hermes 的回复文件路径分别报告，不能声称两者 UI/飞书交付等价。
Hermes write_file 自带落盘 hash 检查且工具说明建议不要回读；任务仍明确要求回读，是否遵从按实际记录报告。
系统提示、schema、客户端及缓存统计口径不同，记录差异，不声称逐字相同的请求或稳定速度胜负。

## 执行

先通过 Hermes 自带 `scripts/run_tests.sh` 执行同目录 keyless 测试，验证真实插件发现与工具拦截/文件结果。
再运行 Node 启动器；每次输出进入新的私有目录，失败保留，不覆盖既有文件。
本机固定路径下的执行命令为 `node --experimental-transform-types benchmarks/hermes-v0.1/fw1-record-files/launch.ts`。
先配置关闭原生自动标题、后台review、记忆和压缩辅助调用，保留原生SessionDB与轨迹；不得把辅助调用遗漏在成本外。
测试插件仅存在于隔离 profile；执行后关闭原生 Agent 并卸载插件，不连接聊天渠道、不改生产 profile。
此四题全通过也只能支持有限工作流结论，不能宣称完整 Hermes 替代、学习收益、线上启用或回滚。
