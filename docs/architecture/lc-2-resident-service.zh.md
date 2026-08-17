# LC-2 用户级 DSH 常驻服务

## 用户结果

对只在一台开发机运行 DSH 的用户，`dsh-resident` 把一个明确的 DSH CLI/profile 配置成用户级
操作系统服务：用户登录后启动，DSH 进程退出或崩溃后自动拉起，操作者可查看 exact 状态并完整删除
service unit。它与 `dsh-goal-continuity` 组合后，外层恢复进程，内层只为预授权 Session 继续原生 Goal。

审计基线为 DeepSeek Harness `47f943859bef60e4160492346772ded9b24f765a`。该 revision 已提供
[CLI profile dispatch](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/apps/cli/src/bin.ts#L28-L38)、
[profile boot 与 SIGTERM 收尾](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/apps/cli/src/profile-boot.ts#L202-L223)、
插件组合、持久 Session/Goal，但没有安装 launchd/systemd user service 的用户结果。LC-2 因而是可选
Feature Extension，不是对 DSH Core Defect 的修补。

## 最小接口

```text
dsh-resident plan   <exact paths/profile>          # 只读，输出完整 JSON + unit
dsh-resident apply  <exact paths/profile> --confirm-deployment
dsh-resident status --profile <name> --dsh-home <absolute-path>
dsh-resident remove --profile <name> --dsh-home <absolute-path> --confirm-deployment
```

公开参数只有 manager、profile、DSH JavaScript entry、Node executable、`DSH_HOME` 和工作目录。
manager 默认随当前 OS 选择；非本机 manager 只能 `plan`，不能 apply/status/remove。

```text
one explicit config
       │
       ▼
pure plan renderer ──> inspectable unit
                            │ explicit deployment confirmation
                            ▼
                 launchd / systemd --user
                            │
                            ▼
          exact Node + DSH entry + --profile
```

## 权威与状态

- service id 只由 normalized `DSH_HOME + NUL + profile` 的 SHA-256 前 16 位派生；同一配置可重复定位；
- unit file 是唯一持久配置；launchd/systemd registration 和 active state 是运行权威；
- CLI 执行完 `plan/apply/status/remove` 就退出，不保留 daemon、timer、watcher、队列或状态数据库；
- `registered`、`active` 和 `unitPresent` 分开报告，避免把 backoff 中的已注册服务说成正在运行；
- remove 停止并删除 unit。macOS stdout/stderr 日志保留为故障证据，不被隐式销毁。

launchd 与 systemd 只是私有 platform adapter，不是公共框架接口。当前没有第三种真实 manager，也没有
消费者要求扩展，因此不建立 provider registry、supervisor service 或配置 DSL。

## 安全、权限与秘密

- `plan` 不写外部状态；`apply` 和 `remove` 是 Protected Action，每次必须显式
  `--confirm-deployment`；
- Node、DSH entry、home 和 cwd 必须是已存在、绝对、normalized 的路径；Node 还必须可执行；
- unit 直接使用参数数组或 systemd quoting，不经过 shell，也不依赖 `PATH`；
- unit 只写入 `DSH_HOME`，不枚举、读取或复制 API key、token、shell 环境或 `.env` 内容；
- unit 以原子 rename 写入，文件 mode 为 `0600`；新建日志目录请求 `0700`；
- LC-2 不扩大 DSH 内部 Tool、Shell、网络、文件、Approval 或 Goal 权限。恢复后的每个动作仍由原生
  DSH policy 决定。

## 平台语义

macOS 使用用户 LaunchAgent：`RunAtLoad=true`、`KeepAlive=true`、`ThrottleInterval=5`。Linux 使用
systemd user unit：`Restart=always`、`RestartSec=5s`、60 秒内最多 5 次 start。两者都在正常退出后重启，
因此“长期停止”必须显式 remove。LaunchAgent 要等用户登录；systemd 离线登录前启动可能需要操作者
另行配置 lingering，LC-2 不擅自执行该部署动作。

## KV Cache 与 token

`dsh-resident` 不进入 DSH profile composition，不注册 Bundle、Service、Tool、Skill、Prompt、Command、
Remote 或模型调用。它在模型进程外生成并管理 unit，所以空闲和运行时额外 token 都是 `0`，也不会改变
同一 Session 的 system prompt、Tool Schema、Skill catalog 或消息前缀。

进程被恢复后，DSH 自身和授权的 Goal 可能继续产生正常模型费用；那是原生运行语义，不是 LC-2 注入的
上下文成本。LC-2 不以动态状态、时间或 PID 改写任何模型请求。

## 失败与恢复语义

- plan 校验失败时不生成可应用结果；
- unit 写入或 manager 操作失败时返回非零，不把未知状态说成成功；既有 unit 可用 status 检查并用
  显式 remove 清理；
- manager crash-loop/backoff 是 OS 状态，不由第二套 retry engine 接管；
- LC-2 只能恢复进程，不能修复损坏的 DSH profile、Session、Goal、Storage 或外部效果；
- DSH 在外部不可逆动作边界崩溃时，仍必须依赖对应插件的 intent journal、幂等键或人工处置。

## 非目标

- Mission、任务 DAG、通用 daemon、第二 supervisor、状态数据库或工作流引擎；
- 多机选主、故障转移、共享状态、SLO 或“高可用”声明；
- Windows Service、容器/Kubernetes、秘密 provisioning、日志聚合/轮转、自动更新；
- 自动发现 DSH 安装、猜测 profile、扫描 Session 或决定哪个 Goal 应继续；
- 修复 DSH 启动、退出、配置、Loader、Session 或 Goal 的 Core Defect。
