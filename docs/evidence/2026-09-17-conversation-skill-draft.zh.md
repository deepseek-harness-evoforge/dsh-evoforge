# 普通纠正到隔离 Skill 草稿

## 本次结果范围

本增量让已识别的普通纠正进入两角色草稿准备：先封存测试材料，再提出可查看的 Skill 文本。
它不是完整 Evolution Candidate，也没有任何安装、评测通过、晋升或当前会话变更权限。

固定 DSH `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` / `0.1.6-alpha.1`。本轮 fetch 后 HEAD 与 origin/master
一致、工作树干净；frozen install 224ms 与完整上游 build 通过。没有修改上游核心。

## 真实调用前固定的判据

沿用上一轮真实 E2/E3 纠正账本；二者构成相邻纠正链，只以末端 E3 起草，不算两个独立样本。
只对原验收 Workspace 启用独立的每天 2 次模型调用预算，不增加识别预算、不更改凭据或权限。
第一个请求只能准备测试材料，第二个请求只能接触原纠正，不能接触测试题、参考答案或评分反馈。

预期草稿给出可复用的窄屏报告呈现方法，保留事实/来源/未知与冲突；不得把一次不使用表格的要求扩大为所有输出禁表格，
不得把草稿当作已改进的 Skill。两条纠正的具体任务文件名和私人路径不应出现在草稿中。
先封存模型实际草稿，再检查结果；不能看了封存题目后手改草稿来获得通过。

## 本地与原生组装验证

- 定向七文件 63 项测试通过：draft、intake、native E2E、config、control-plane、remote、feedback monitor。
  命令在 dsh-evolve 中以实际设置的 `DSH_EVOLVE_DSH_SOURCE_DIR` 指向上述审计源码执行 Vitest，`--maxWorkers 1`。
- 新原生路径使用真实 Context、Storage Domain/JSON、Session 持久化、LLMRuntime 与 Jobs；验证两个独立请求、
  没有给 proposer 测试答案、没有写入源 Session、没有带 owner 的 Job 自动产生新 Agent turn、冷恢复不再次调用模型。
  这是 fixture adapter 组装证据，不冒充真实 provider 或评测效果。
- 草稿测试覆盖四个 durable crash point、跨 UTC 日的幂等、并发/预算、存储拒绝、来源不匹配、输出格式、
  治理正反例校验、相邻纠正链和无明确 finish 不算成功。新模块缺失及新配置项测试先红后绿。
- Web 双语言真实 locale 测试先红后绿：可查看草稿，明确测试材料未运行，不提供启用按钮。
- Host/Web 类型检查、构建、Typert 生成及文档/CI 路径检查通过。
- Web 全量两文件 34 项通过；clean-profile 两项原生生命周期测试通过（40.67s）。
- 官方 product 隔离安装通过，持久清单 pack `7f142dbd14d6cf2ebb68ba8c62ac4cf02473a63a8cfd74e5848b52bdeda0d056`。

## 真实部署结果

待完成后填入；当前不声明已通过真实模型起草或部署。

## 限制

模型生成的测试材料只做结构及正反例断言校验，不保证事实正确、任务独立、难度合适或无评分漏洞。
此草稿未运行 baseline/candidate paired，不可用于宣称泛化提升；独立任务评测、后续会话启用和回滚仍待贯通。
整份草稿 Domain 含私有模型生成内容，不能称为 raw-free。原生页面只显示草稿，不向 proposer 或 Web 泄露测试答案。
