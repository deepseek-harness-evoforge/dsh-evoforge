# ADR-0076：现有 Skill 基线在原生调用边界封存完整 Bundle

现有 Skill 的 invocation-content hash 只能证明模型可见正文相同，不能替代资源树、二进制资源或完整安装包。`dsh-evolve` 因此在原生 Agent `pre-step` 边界观察 durable Skill 调用，不增加 Tool、Prompt、路线菜单或第二套 Session。Host 在 `agent/session-start` 固定事件高水位，只封存本次 Agent 生命周期中新发生的调用；冷恢复历史调用或 observer 晚挂载前的调用一律不使用当前目录追溯重建。对新调用，Host 复用同一 DSH Skill Registry、Agent scope 与 Workspace cwd 重新加载定义，并要求 durable content blocks 与官方 `renderSkillContent()` 输出逐字一致。

只有具有独立目录边界且入口严格为 `<resourceBase>/SKILL.md` 的已安装 Skill 可封存。URL、opaque resource、flat Markdown、符号链接、特殊文件、可执行文件、超预算目录和定义/目录漂移均 abstain，不影响原 Session。Host 对完整目录执行两次扫描与两次定义校验，以 canonical tar.gz 封存所有 regular files；Bundle id 绑定 Workspace、Skill、调用内容、DSH 定义、provider/source、archive digest 与 tree hash，不包含 Session id。另以 `(Workspace, Session, invocation seq)` 写入不可变引用，因此同一内容可复用一个基线，而一次调用不能被改绑到另一基线。

封存物固定 `releaseAuthority: none`，存放在既有 Workspace evaluation `governanceRoot` 下，不进入 Git 分支、不修改当前 Session，也不授权 Candidate、安装、晋升或回滚。后继必须把两个或更多 exact correction 所引用的调用逐一解析到同一个完整基线，才可把 `Existing Skill Improvement Opportunity` 从 `waiting-for-baseline-bundle` 推进到独立 author/admission/holdout；任何调用缺失、Bundle 不同或存储损坏都继续 fail closed。
