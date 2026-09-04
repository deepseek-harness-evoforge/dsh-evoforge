# 能力套件

套件只负责安装编排。DSH 仍逐个加载 Bundle，每个 Bundle 保持独立权限、生命周期、禁用和卸载边界。

## 用户入口

| 套件 | 安装结果 | 默认性 |
| --- | --- | --- |
| `product` | Evolution、Doctor、统一 Control Center、常驻 Gateway、Feishu、Telegram | 默认完整产品 |
| `delivery` | 隔离软件交付与确定性完成检查 | 可选 |
| `continuity` | 原生 Goal 冷恢复与用户级 resident service 管理 | 可选，建议管理 profile |
| `attention` | 将待审 Candidate/晋升提醒发送到已授权渠道 | 可选附加包 |

`product` 中 Gateway 默认启用且 routes 为空；Feishu/Telegram 默认关闭，只有配置 CredentialProvider 与
pairing/exact route 后才连接平台。`core`、`channels`、`evolution`、`control`、`gateway` 仅为旧部署迁移和
独立开发保留，`full` 只用于维护者验收。新用户不需要从这些内部拆包中选择。

默认安装：

```sh
pnpm run dsh:install
```

安装器只使用 manifest 中校验过的 exact tarball，并把它们留在持久用户数据目录，避免 profile 指向已经删除的
临时文件。当前没有 registry 包，裸 `dsh-*` 名称不能当安装源。

## 为什么仍有多个 Bundle

| 边界 | Bundle | 必须独立的原因 |
| --- | --- | --- |
| 进化 Host / 浏览器 | `dsh-evolve`、`dsh-evolve-web` | Host 状态与 Client 构建、卸载时机不同 |
| 公共页面 / 诊断 | `dsh-control-center`、`dsh-doctor` | 页面壳不拥有业务状态；诊断可只读独立运行 |
| 路由 / 平台协议 | `dsh-gateway`、`dsh-feishu`、`dsh-telegram` | 路由权威只保留一份，平台凭据和故障域隔离 |
| 交付 / 外部 review | `dsh-software-delivery`、`dsh-github-review` | 代码副作用与不可信 GitHub 输入权限不同；后者尚未进入公开套件 |
| 冷恢复 / OS service | `dsh-goal-continuity`、`dsh-resident` | Session 策略与系统服务写入是两类权限 |
| 进化 / 通知 | `dsh-evolve`、`dsh-evolve-attention` | 没有渠道时进化仍可运行；提醒没有审批权 |

这不是十二个产品入口，也不是把职责合进一个巨型 Gateway。新增 Bundle 必须证明存在独立生命周期、权限、
外部依赖或信任域；否则扩展现有 Bundle。

## 名称边界

逻辑 id、仓库目录、发布名和 DSH remove 名不能混用。当前渠道包例如：

| 逻辑 id | 仓库目录 | 分发/remove 名 |
| --- | --- | --- |
| gateway | `packages/dsh-gateway` | `dsh-evoforge-gateway` |
| feishu | `packages/dsh-feishu` | `dsh-evoforge-feishu` |
| telegram | `packages/dsh-telegram` | `dsh-evoforge-telegram` |

完整名称与 SHA-256 由每次安装生成的 `evoforge-suite.json` 记录。卸载使用其中的 `dshRemove`，不要猜短名。

## 不变量

- 套件不会创建第二个 Runtime、Session、Goal、Approval、数据库或 Web。
- Adapter 禁用、reload 或卸载时必须释放 transport、listener 和 timer。
- Candidate/Generation 使用内容寻址存储，不使用 Git 分支；仓库开发只在 `main`。
- 卸载后 DSH 原生 Session/Goal/Workspace 仍可读，已经发生的外部效果不会被伪称撤回。
