# 飞书已配对会话的首轮归属修复与真实复测

## 结果与边界

代码 `68892e0` 已推送并部署；唯一核心仍是 DSH `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`
（`0.1.6-alpha.1`）。本次没有修改核心、凭据、配对授权、会话权限或文件交付开关。

真实 C2 仍虚报附件已发送；本次定位并修复了配对路径的绑定时序。部署后真实 C3 的原生 `present`
显示“交付失败”，飞书明确回复“发送失败，未能交付附件：文件交付未获 Native Approval 确认。”
这证明该回合不再把 Web 展示冒充渠道送达，**不证明文件已可下载**。

下一步受到已有原生授权策略阻止：该会话最后一个 `permission/preset` 为 `danger-full-access`，
最后一个 `approval/policy` 为 `never`，C3 的 `approval/decided.outcome` 为 `rejected`。
以上通过原生 Persistence 的 `open(id, 'read') → read → close` 读取，未修改日志。
上游这个预设确实把需要询问的动作自动拒绝，而非自动批准；不能为了验收绕过它。
需用户批准改变会话审批模式后，再验证真实审批、上传、下载字节和重启无重复发送。

## 可复现步骤与根因

1. 在原 DSH 飞书私聊要求把既有虚构验收表作为可下载附件发送，限制只读该文件、等待审批、不得虚报。
2. C2（19:36）在 Web 有成功的 `present` 结果和文件卡，飞书只有“已重新发送为可下载文件附件”。
3. 隔离测试改为配对到一个已存在的原生 Agent，不预先配置适配器路由。
4. `gateway.dispatch()` 内部在返回前调用原生 `followup()`；此时可能已经触发 `agent/inbox/claimed`。
   原实现到 dispatch 返回后才 bind，漏掉入站归属，`present` 桥因此视为非飞书回合。
5. 通过 Gateway 先 resolve 原生 Agent 并 bind，再 dispatch。没有新建路由权威或模型工具。
6. 保持旧会话，重启部署后的唯一 Host，发送 C3（19:49）。Web 和飞书均明确失败，不产生成功文件卡。

固定材料：`evoforge-feishu-acceptance-result.md`，131 字节，完全虚构；内容在本轮未变。
SHA-256：`980434b0776b633935e9a582a728e49bb71e249e394bb0734ed35d3179d0c16b`。
C3 为 2 次工具调用、13 秒，Web 显示约 30K tok；未得到费用数据，不作成本优胜声明。

## 实际执行的检查

- `pnpm run audit:dsh:latest -- --source <isolated-0d1f5000-worktree>`：fetch、clean、frozen install、官方 build 均通过。
- 在 `packages/dsh-feishu` 运行以下命令，环境指定同 revision 的独立原生文件 Host：
  `DSH_FEISHU_TEST_NATIVE_FILES=1 DSH_EVOLVE_DSH_SOURCE_DIR=<native-host> pnpm exec vitest run test/dsh-assembled-file.e2e.test.ts -t "pairing.*present.*approve" --maxWorkers 1`。
  修复前 849ms 失败：审批卡预期 1，实际 0；修复后 1 秒通过。
- 完整 `pnpm exec vitest run --maxWorkers 1`（上述原生文件环境）：28 个文件、133 个测试通过，约 96 秒。
  包含 routes、pairing、已有 request header 的 pairing；批准、拒绝、错误用户；旧 Web present 不外发，
  完整请求工具列表不漂移。测试 transport 和 LLM 是隔离替身，不是平台成功证据。
- `pnpm run typecheck`（飞书包）、`pnpm run check:docs`、`git diff --check`：通过。
- `packages/dsh-software-delivery` 的 `test/clean-profile-suite.e2e.test.ts`：2/2 通过，约 51 秒。
- 官方安装器先在私有 preflight home 完成 product add/dump，再用于实际安装的持久内容地址包。

## 部署、数据与恢复

持久 product manifest digest：`a2f8d0c0f421efbc397a7e46dc6a95463b5f907a3cf1da74a76cd6b9ab791e98`。
安装前验证旧 Host 身份并停止；端口空闲后备份 profiles 和 sessions 到权限 0700 的私有切换目录，
官方 add/dump 均通过。安装后的 22 个 Session 文件与该冷备份逐字节相同，profile patch 未变。
启动后只有一个 `127.0.0.1:3000` listener；Web 刷新恢复原会话，原飞书配对继续收发 C3。

旧包与冷备份保留，可回滚插件包；不能把回滚插件与降级核心混为一谈，也不能撤回外部已发送效果。
本次没有批准文件发送，未验证真实上传或下载；截至 C3 没有文件 outbound domain。
没有启动第二控制面、后台替代发送、重新配对或创建子智能体。
