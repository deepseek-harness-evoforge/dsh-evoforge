# P2B.1 证据：原生 Goal 受验证完成动作

> 日期：2026-08-16  
> 声明等级：`implemented`；不是全局 Goal completion guard，也不等于完整自动交付

## 用户结果

完整 DSH Goal/Shell composition 中出现一个稳定 `complete_delivery` Tool。Agent 一次调用即可
绑定 exact Goal revision、验证 exact Git commit、通过原生 shell policy 运行 repository checks，
并且只在 `passed` 时使用原生 `update_goal` 完成同一个 Goal。

`failed`、timeout/abort、原生 Tool policy 拒绝、陈旧 Goal revision 或检查期间 Git 漂移都不会
完成 Goal。standalone `dsh-delivery verify` 仍可独立使用。

## Test-first 行为证据

红灯首先证明 Agent 无法调用尚不存在的 `complete_delivery`。实现后覆盖：

- 真实 linked worktree + commit + check 通过，exact native Goal revision 增加并进入 `complete`；
- check 非零返回 `failed`，Goal 保持 `active`；
- stale Goal revision 在任何配置 check 的副作用发生前拒绝；
- 原生 `ctx.tools.guard` 拒绝嵌套 Bash 时返回 `unknown`，Goal 保持 `active`；
- 带单引号、分号和 `$()` 的 argv 保持原样，不能变成 shell 注入；
- caller abort 会终止 standalone runner 的 POSIX 进程组与后代，不遗留延迟副作用；
- 插件先于 shell/ToolGoal 加载仍能在依赖出现后注册；dispose 只移除自己的 Tool/Skill，保留
  原生 `bash` 和 `update_goal`；
- output 截断时明确区分 full hash 与 retained hash，不把局部摘要伪装成完整输出摘要。

## 固定 DSH 真实组合

固定 DSH revision `47f943859bef60e4160492346772ded9b24f765a` 上，测试动态加载真实：

- Goal、ToolGoal、Tools、Agent、Agent Loop；
- Local Subprocess、Shell Env、Local Bash 与 Tool Bash；
- `dsh-software-delivery` 和 keyless scripted LLM adapter。

真实 Agent 调用 `complete_delivery` 后，check 经原生 Bash 执行，完成经原生 `update_goal` 执行，
Goal 进入 `complete`。连续两次模型请求的完整 Tool 数组相等。插件卸载后原生 Bash 与
`update_goal` 仍在。

## Cache、权限与限制

- 正常 composition 只增加一个固定 Tool；其序列化 Schema 由测试约束为 `≤ 2 KiB`。
- Skill body 仍按需；没有 system prompt、动态进度 Tool、Mission 或第二 Goal。
- 成功结果只返回 commit、repository facts 和 check hash/byte facts；失败 preview 总量受 4 KiB
  单流上限约束。实际 token 数取决于 tokenizer，因此不伪报固定 token。
- 集成 check 委托原生 `bash/pwsh`，已有 sandbox/approval/Tool guard 权威不变。Git 状态检查是
  插件内只读本地进程。
- 这是推荐的原子完成动作，不拦截所有原生 Goal transition。直接 `update_goal` 仍可供人类和
  其他工作流使用。
- 尚未实现 push、Draft PR、Evolve outcome adapter 或真实开发任务统计；没有前端，因此不触发
  浏览器 E2E。

设计取舍见 [ADR-0013](../adr/0013-verified-completion-delegates-native-tools.md)。
