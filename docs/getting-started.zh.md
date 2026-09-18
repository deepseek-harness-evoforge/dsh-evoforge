# 安装、配置与卸载

EvoForge 只加载进现有 DSH Host，不启动第二个 Agent Runtime、Web 服务或 Gateway。当前仍是 pre-alpha，尚无
registry 包；本页描述可复现的仓库安装方式。

## 1. 准备

- Node.js 22.19 及以上的 22.x，或 Node.js 24 及以上；pnpm 11；
- 已审计的 DSH `0.1.6-alpha.1` / `0d1f500` CLI；
- 一个可写的 DSH profile，默认名为 `web`；
- 使用渠道时，准备平台应用和最小权限。

插件与核心需要成套兼容，不要直接安装到旧 alpha.5。当前支持 revision 与部署范围见[当前状态](status.zh.md)；
“版本号相近”不代表可以安全升级或降级。

## 2. 一行安装完整产品

在仓库根目录运行：

```sh
pnpm install --frozen-lockfile && pnpm run dsh:install
```

默认安装 `product`：Evolution、Doctor、Control Center、Gateway、Feishu 和 Telegram。指定其他 profile：

```sh
pnpm run dsh:install -- --profile personal
```

可选附加能力：

```sh
pnpm run dsh:install -- --suite delivery --profile web
pnpm run dsh:install -- --suite continuity --profile admin
```

安装器在新 staging 中打包，读取 `evoforge-suite.json`，校验 exact 文件与 SHA-256，再把整组产物按内容地址
原子保存到用户持久数据目录；DSH 安装的永远是该目录中的绝对路径。Bundle 已预构建，因此安装显式禁用依赖
install script，不替用户授予第三方构建权限。成功只清 staging，失败保留可恢复产物。两次 DSH 配置核对均在
进程内完成，完整 effective config 不会打印到 Agent/终端日志。

安装命令会修改目标 profile。人在 shell 中直接运行时，这不是 DSH Agent Approval；由 Agent 通过 DSH Shell
运行时，原生 Tool policy/Approval 仍然生效。安装插件不会写 OS service，只有随后显式执行
`/resident apply <hash>` 才会创建服务。

## 3. 启动一个 Host 和一个页面

```sh
dsh --profile web --no-open
```

只打开启动日志给出的完整 URL，并保留 `?token=...`。裸端口返回 401。以后刷新现有标签页，不要因为安装了
Gateway、Evolution 或渠道再启动 Host。Control Center 是 Session-scoped；先创建或打开原生 Session，空白
onboarding 页面可能不会渲染该 slot。

## 4. 飞书

完整产品已经安装飞书 Adapter，但它默认关闭。先在该 profile 的官方 patch 中增加或覆盖：

```yaml
- id: evoforge-feishu
  name: dsh-evoforge-feishu
  disabled: false
  config:
    mode: pairing
    routeIds: []
    appIdEnv: DSH_FEISHU_APP_ID
    appSecretEnv: DSH_FEISHU_APP_SECRET
```

`appIdEnv` 和 `appSecretEnv` 是历史命名保留的 **CredentialProvider 引用名**，不是让用户导出环境变量。启动
Host 后，在同一 Control Center 的 Feishu 凭据表单保存 App ID/Secret；值只进入 DSH CredentialProvider，不能
写进 YAML、Git、日志或 Session。

飞书开发者后台至少需要机器人、长连接事件 `im.message.receive_v1` 和发送消息权限，并发布当前应用版本。随后：

1. 陌生用户发送第一条私聊；Gateway 返回一次性配对码，消息不进入 Agent。
2. 管理员先打开要绑定的工作区与会话，再进入 **控制台 → 渠道**，核对后批准配对。
3. 用户发送下一条消息；它进入绑定的原生 Session。

pairing 不需要用户手工提供 `chat_id` 或 `open_id`。过期码、重放、没有可用 Session、身份不匹配或不确定发送
结果都会停在可诊断状态，不会盲目重试。

不要在上述 pairing 配置中添加 `contentPermissions`：当前 pairing 模式不接受它。知识库、云盘、多维表格等
内容读取另受静态路由与对应权限约束，不因私聊已配对而自动开放。

### 输出文件发到飞书

文件外发默认关闭。确实需要此能力时，由管理员在已有飞书 row 的 `config` 内启用 `fileDeliveryEnabled: true`，
保留其他设置和凭据引用，不重建配对。该开关与上述内容读取权限不同。

在已授权的机器人私聊中明确要求“生成文件并作为附件发到本对话”。当前任务必须来自飞书；在 Web 里展示文件
不会自动向飞书外发。原生完全访问权限允许直接交付工作区输出文件；其他权限仍须经过原生文件快照与接收方审批。
不要为了绕过等待审批而切换到完全访问。

验收时在飞书检查文件气泡，打开或下载后核对内容。只有确认送达的回执表示发送成功；本地路径、Web 文件展示、
模型说“已发送”均不能单独证明交付完成。发送结果不明时先核对聊天和已有记录，不直接重发。
短表格消息与文件预览不是同一种排版：宽表格在附件预览中仍可能被裁切；可要求改为逐项小节并保留事实和来源。

## 5. Telegram

Telegram Adapter 同样默认关闭。最小 pairing patch：

```yaml
- id: evoforge-telegram
  name: dsh-evoforge-telegram
  disabled: false
  config:
    mode: pairing
    accountId: telegram-bot-prod
    tokenEnv: DSH_TELEGRAM_BOT_TOKEN
    routeIds: []
```

`tokenEnv` 也是 CredentialProvider 引用名。保存 Bot token 后，陌生私聊使用与飞书相同的“首条配对、页面批准、
下一条进入 Session”流程。静态生产路由必须精确绑定 account、conversation/user、Workspace、Session、Agent、
provider 和 model，不接受 wildcard。

## 6. 日常使用与进化

### 先完成当前任务

打开工作区中的原会话，核对输入框旁的模型和访问权限，然后直接发任务；普通聊天不需要创建 Goal。
明确输入、输出和“不允许做什么”，例如：

> 只读我提供的两份材料，整理已确认事项；冲突和未知值保留并注明来源。写成一个新文件，回读核对。
> 不修改输入，不执行命令，不联网。若从飞书发送此请求，请将结果作为附件发到当前对话。

这些文字是任务约束，不会自动收紧或扩大原生权限。执行过程中按实际审批提示判断是否授权；最后核对文件或
平台结果，而不只看模型的最后一句。需要返工时在同一会话说明具体错误、应保留内容和期望结果。
“本次改好了”只代表当前任务，不代表未来任务已学会。

### 看懂结果与恢复

| 看到的情况 | 含义与下一步 |
| --- | --- |
| 正在执行或后台任务运行中 | 尚无最终结果；检查当前步骤，不重复提交同一外发任务。 |
| 待授权 | 尚未获准执行对应操作；核对文件、动作和接收方，再决定批准或拒绝。 |
| 对话已结束／工具返回成功 | 执行结束不等于满足需求；核对事实、文件内容、实际附件和可读性。 |
| 失败／未完成／结果不明 | 不算成功；保留原会话与错误，先检查已有产物或平台效果，再决定是否重试。 |
| 连接异常／状态已过期 | 显示值可能是旧状态；先恢复连接或刷新，不据此判定后台任务失败或重发。 |

当前 DSH 版本在出现黄色“等待审批”卡时，可能仍同时显示“深度求索中”。此时以审批卡为准：对应操作
正在等你决定，并未因计时继续而获得授权。查看具体命令或文件与接收方；不确定就点“拒绝”，不要切换到
完全权限来消除提示。“允许一次”只批准当前操作，不是永久放行。拒绝后仍须核对最终说明和已有产物，
拒绝不会撤销此前已完成的动作。审批理由中的 `workspace-write` 表示本次请求工作区写入权限。

若等待审批时刷新了页面，先回到原会话，核对恢复的审批卡仍是原来的命令和目标，再决定；不要重新发送任务。
批准后检查实际结果，并确认会话访问模式没有被永久放宽。刷新页面不等于重启 Host；不要据此假定待审批请求
也一定能跨 Host 重启恢复。

重启后打开原工作区与原会话。若刚才涉及发送、上传或写文件，先要求只读检查已完成部分，再决定补做什么。
不要为“恢复”另起一个 Host、清空账本或删除历史。详细重连步骤见第 8 节。

### 普通纠正与 Skill 草稿

在 **控制台 → 演化** 查看状态。默认不启用付费纠正识别、草稿准备或对照检查；管理员必须分别配置当前工作区的
预算策略。普通消息不是开启这些权限的开关；未配置时仍可正常聊天和返工。

- “聊天纠正线索”是模型对消息的未验证解释，不等于原生回答负反馈，也不代表效果改善。
- 也可以在回答下点击“有问题的回答”并补充具体错误。管理员启用该原生会话的 `explicitFeedbackSessionIds` 后，
  带说明的负反馈可直接进入同一草稿预算，不必另做一次聊天识别。未授权会话仍只记录反馈。
- “Skill 草稿（未启用）”可以展开查看，但不会安装到当前或未来会话。准备测试材料与起草是独立步骤。
- “字面断言通过”只是固定文字检查，正确的另一种表达也可能失败，不能当作任务完成率。
- 可选语义评测仍默认关闭；会先校准裁判，裁判不确定或校准失败则不宣称改善。它仍可能误判，不能代替文件、视觉或平台验收。
- “未观察到改善”不是学会；即使检查显示改善，也不授予草稿自动启用或晋升权限。

预算是模型请求名额，不是费用上限，包含中断后保留的预留。降低配置上限后可能显示“已用数大于上限”，不代表
仍在继续调用；到达 UTC 次日后按新一天计算（北京时间每日 08:00），旧实验仍不会自动重跑。
不要清零记录、复制工作区或反复重试来绕过配额。未完成请求的用量缺失表示未知，不是零费用。
反馈被修改、撤回或改为正面后，旧版本不能继续用于准备或对照检查；已发生的消耗和历史结果保留。
同一回答的反馈编辑不会自动获得一次新的起草机会。停用这条来源应撤回配置，不要用旧程序覆盖新账本。

当前普通纠正已经能进入隔离草稿和有限对照检查，但尚未证明未见任务的稳定收益，也未贯通这条路径的未来会话启用
与精确回滚。现有其他候选管理功能不代表这些草稿已取得资格；完整限制见[当前状态](status.zh.md)。

## 7. 更新与卸载

本地升级重新运行同一个安装命令，会产生新的内容地址并交给 DSH 协调。不要删除安装器打印的持久数据目录；
DSH 的 profile/lockfile 可能继续引用其中的 tarball。

这里更新的是 EvoForge 插件，不等于升级 DSH 核心。当前开发版本要求固定的 DSH `0.1.6-alpha.1`；已有 alpha.5
部署应保留原插件包，不能只更新插件而不迁移核心。跨版本升级必须另做停机备份和恢复验证；本地测试通过
不代表你的现有 profile 已完成升级。已验证的风险是：新版核心续写后，
换回 alpha.5 可能不报错，却只显示升级前的历史。因此不能只替换程序来回滚，也不要删除新格式日志。
如需恢复升级前快照，先保留升级后的完整数据，并明确快照不包含升级后新增的消息与操作记录。

成功输出会给出 `Verified manifest` 路径。打开该 manifest，复制 `dshRemove`，把 `<profile>` 换成实际 profile 后
执行。然后重新启动一个 Host，确认 EvoForge 表面消失且原生 Session/Goal/Workspace 仍可读。卸载不会撤回
消息、提交或其他外部效果。

若安装过 `continuity` 并实际执行了 `/resident apply`，必须先运行 `/resident status`，再用
`/resident remove <service-id>` 删除 OS service；仅卸载 Bundle 不会伪装成已撤销系统服务。

## 8. 排障

1. 在原生 Session 运行 `/doctor`，先看 Loader、Bundle 和 Gateway 状态。
2. Web 401 时重新使用启动日志中的完整认证 URL。
3. 页面消息不更新或重启后选择工作区一直加载时，先展开侧边栏。若有“连接异常”，点击原生重连按钮。
   旧 alpha.5 部署在多次重连失败后会暂停自动尝试；Host 已重新启动也不一定会自行恢复网页事件连接。
   仍未恢复时，先保留尚未发送的输入，再刷新同一个标签页。不要另启第二个 Host；已发送任务先核对原会话
   与实际产物，不要直接重发。渠道连接正常不等于 Web 事件连接或任务结果正常。
4. 渠道页打开时会自动读取状态；“状态已过期 / 上次状态”表示旧值，不代表当前仍在线。恢复后会自动更新，
   也可手动刷新。渠道停在 waiting 时，检查 Adapter 是否启用、CredentialProvider 引用是否存在、平台事件订阅是否已发布。
5. `unknown`/`uncertain` 时先核对 Gateway journal，不要重复发送。
6. Issue 只附脱敏的 revision、命令和状态；不要附完整 `--dump-config`、Secret、token、真实消息或私有样本。

套件边界见[能力套件](capability-suites.zh.md)。贡献者的真实渠道、Provider 与 Hermes 验收命令只在
[发布门](releasing.zh.md)和[benchmarks 说明](../benchmarks/README.md)中维护，不属于用户流程。
