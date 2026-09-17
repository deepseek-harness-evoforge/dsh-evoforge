# 飞书表格呈现修复与真实验收

日期：2026-09-17。修复 `62c922b`；范围是已配对私聊中表格回复的可读性，不是新的 Agent 能力或进化效果。

## 复现与修复

固定 D1/D2 的数据正确但飞书显示竖线原文，Web 为正常表格，见
[约束任务验收](2026-09-17-feishu-constraint-task.zh.md)。`platform.ts` 原先无条件发送 `{ text }`。
新增三条表格平台用例在旧代码下稳定失败；修复将有表格分隔行的短文本转换成一个原生 `post`、`md` 元素，内容逐字不变。
使用已安装的官方 SDK 1.73.3 的 post 发送能力，不增加卡片按钮、第二发送器或模型提示词。

单条最多 3,500 字符，与 SDK 当前文本分块阈值一致；更长文本保留旧路径。含 `<` 或 Markdown 图片起始语法的文本
也保留原发送方式，不在本增量中把字面标签/图片解释成平台提及或媒体。没有改写表格、文件、Gateway schema、回执或
reply/thread 目的地。SDK 只对确定的格式拒绝提供原有 post→text fallback；模糊错误不增加重试。

模型组成、Session 内容、存储字段和权限不变；卸载保留原生历史和已发送消息。回退兼容飞书包只影响未来发送的显示。

## 本地与组合验证

- 本轮 canonical checkout fetch 后 HEAD=origin/master=`0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`，
  CLI 0.1.6-alpha.1，工作树干净；frozen install 和官方完整 build exit 0。
- 飞书全量 29 文件、161 tests 通过，包括原生聊天/文件/审批/计划、取消和安装卸载。
  后续补充长消息阈值后，平台 14 tests、typecheck、build 通过；最终原生聊天、打包安装移除及平台窄回归 3 文件、16 tests 通过。
- `check:docs`、`check:ci`、`git diff --check` 通过。两次隔离 preflight 的官方 product add/dump 均通过，最终安装使用后者。

## 部署和真实平台

- 从已校验 product pack `6d9916798a68cc9eb81dd760be72b4cb02fabdd7ec605737931d57ad1c35f82e` 仅 add 飞书包。
  冷停唯一旧 Host 后，私有备份 profile/sessions。安装后 22 个历史文件及 profile patch 逐字节不变，其他依赖不变。
  核对安装后的代码实际包含新的呈现函数和 3500 阈值；重新启动仍仅一个本地 Host。
- 原 Web 页刷新恢复全部旧任务，仍显示完全权限。原飞书私聊 D3 要求原样输出 D2 表格，平台树实际出现四个列标题、
  两行八个单元格；截图同时显示 D2 旧原文和 D3 新表格，确认不是只有 Web 变好。
- D3 原生 turn 17 completed，只有一个 step，没有工具调用；原生耗时 4945 ms，UI 4 秒、11.2K tok。没有额外提示。
  Gateway 账本对应一个 delivered、attempts=1。
- 随后再次冷停并启动同一 Host，检查无重发。预定 D4：不重述数据，要求恢复刚才四列完整表格；期待仍为林/周三/已完成、
  陈/周五/未明确，并在飞书渲染为表格。只允许文本回答，不使用工具或更改权限。

- 冷重启后 D3 的精确账本仍为 delivered、attempts=1。D4 实际飞书仍为四列表格，两行数据和未知状态正确；Web
  同步显示同一结果，权限不变。原生 turn 18 completed，一个 step、无 Tool/Goal/Approval 事件；4461 ms，UI 4 秒、
  11.4K tok，没有额外提示。两个最新表格回执各一次；此前 C4 附件账本仍仅一条 delivered、attempts=1。
- 最终只有一个本地 3000 监听 Host。未创建其他会话、变更凭据或重新配对。

费用未测，本记录不支持 Hermes 比较或未见任务 Skill 学习声明。长消息、含字面标签/图片语法的混合表格仍采用
保守纯文本路径；本轮没有声称所有 Markdown 或所有客户端版本均已覆盖。
