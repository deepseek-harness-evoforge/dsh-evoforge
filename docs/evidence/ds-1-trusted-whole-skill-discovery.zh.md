# DS-1 可信 whole-Skill 发现纵切

> 日期：2026-08-18  
> 结论：implemented；只证明部署者显式授信的本地 Git 来源，不声称完整 DS-1 或优于 Hermes

## 已证明的用户结果

用户只给自然语言 Goal，DSH 模型仍通过原生 Skill registry 和 `skill` Tool 自主选择能力，不出现
EvoForge 路由菜单。只有 exact Workspace + Session 的目录观测完整、模型请求的合法 Skill 名确实
不存在时，才记录可证伪 Capability Gap；普通 Tool 失败、目录不完整、非法名称和已有 Skill 的运行
失败都不会被冒充为缺口。

对已确认 Gap，常驻 host 循环在后台扫描 `trustedDiscoverySources` 中由部署者显式配置的本地 Git
仓库。发现以整个 Skill 文件夹为原子单位，固定 commit、tree hash、SHA-256 content hash、相对包路径、
文件数、字节数、scripts/references 与权限声明。symlink、submodule、非普通文件、越界路径、错误
frontmatter、名称不一致、超过 256 文件或 16 MiB 的包均 fail closed。

候选只写入独立持久域，状态固定为 `quarantined / inactive / unevaluated / never executed`。发现过程只读
Git object，不 checkout、不运行脚本、不安装 Skill，也不改变当前 Session 或活动 Generation。无可信
来源、无同名 Skill、来源不可用和无效包会形成有界、幂等的 abstain/partial 记录。

配置 exact `discoveryAdmissionTargets` 后，候选按原 commit/tree/content hash 重放到来源仓库之外、权限
收紧且不可执行的隔离副本，并通过原生 DSH Job 进入零模型确定性准入。baseline 与 Case Pack 必须匹配
部署时固定哈希；执行型或非纯指令文件、assembled evaluator、评测期间治理输入漂移均 fail closed。
该阶段的 candidate 代码不会执行，baseline fail / candidate pass 也只得到 `qualified-for-shadow`，结果固定
`releaseAuthority: none`，不能安装、激活、发布或自动晋升。重启会从 durable Candidate 重建 Job，完成
报告按 candidate + target + baseline/Case Pack identity 幂等复用。

## DSH Web 可解释性

Skills 视图现在同时展示：

- 当前 Session 的原生 Capability Map 与实际模型路由；
- 已确认 Capability Gap 及目录证据；
- whole-Skill 候选的来源信任、Git/content identity、包组成、权限与隔离状态；
- 每次发现的 candidate/partial/abstain 结果及原因。
- 确定性准入的 target、baseline/candidate、Trial 数、治理隔离和零发布权限。

Web 不暴露绝对仓库路径、Skill 正文或私有 Session ID，也没有安装、激活、选路按钮。

## 验证

- `dsh-evolve`：覆盖 Git 整包身份、固定版本物化、脚本不执行、无来源 abstain、启动恢复、新 Gap
  非阻塞观察、Storage 重启、真实 macOS sealed deterministic admission、治理输入漂移和控制面脱敏投影；
- `dsh-evolve-web`：`25 passed`，覆盖候选/abstain 解释和无安装/激活动作；
- 全仓 `pnpm check`：docs、types、tests、build 全部通过；Telegram `39 passed`，飞书 `38 passed`。

## 尚未证明

当前没有联网市场、官方文档、论文或通用开源索引；没有从资料生成新 Skill；确定性准入不是完整
assembled DSH rollout，候选尚未通过 governance-separated holdout、回归、迁移、安全、成本、时延和
KV Cache 门禁，也没有进入 Generation/Promotion。真实 provider、陌生用户和 Hermes 同任务 paired
benchmark 仍缺失。因此本纵切是可信 acquisition + pre-admission 起点，不是自动安装，更不是完整自我
进化闭环。
