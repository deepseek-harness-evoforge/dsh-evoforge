# P2A.1 证据：Software Delivery Skill 与 Git 验证器

> 日期：2026-08-16  
> 声明等级：`implemented`；P2 首个纵切，不等于完整软件交付产品

## 用户结果

安装 `dsh-software-delivery` 后，DSH 获得一个按需 `software-delivery` Skill。它把原生 Goal 引导到 sibling linked worktree、仓库检查、clean commit 和可选 Draft PR。打包提供的 `dsh-delivery verify` 对 exact worktree/base/HEAD 运行声明的本地检查，并输出：

```text
passed | failed | unknown + reason + git-commit artifact + bounded check evidence
```

插件独立于 `dsh-evolve`，因此不使用自进化的用户也能获得完整的提交验证价值。

## Test-first 行为证据

红灯首先表现为两个实现模块不存在。实现后固定覆盖：

- 真实 Git primary checkout + linked worktree + feature commit 的通过路径；
- primary checkout、dirty tree、无提交等在执行用户 checks 前拒绝；
- 非零 check 停止后续 checks，并记录完整输出 SHA-256 与有界文本；
- timeout 返回 `unknown`，并终止 POSIX check 进程组，不伪造成产品失败或遗留普通子进程；
- check 即使退出 `0`，只要移动 Git 状态或写脏 worktree，最终仍为 `failed`；
- 子进程不继承测试注入的 credential-bearing 环境变量；
- built CLI 对真实 linked worktree 返回 exact commit artifact。

## DSH 与缓存证据

固定 DSH revision `47f943859bef60e4160492346772ded9b24f765a` 的真实 Loader/Skill/Tool/Goal/Agent Loop 已装配运行：

- 首次模型请求只出现稳定的 `software-delivery` 名称和描述，没有 Skill 正文；
- Agent 通过原生 `skill` Tool 加载后，第二次请求才出现正文；
- 两次请求的完整 Tool schema 相等；
- 插件 dispose 后 Skill 消失；
- packed tarball 可由真实 `dsh plugin add` 安装、App Boot 启动、remove，并在删除后启动只有原生 Skill registry 的 composition；
- 包不是 Bundle，不修改 `dsh.profile.bundles`。

因此 model surface delta 是一个稳定 catalog entry；正文 token 仅在实际按需加载时产生，数值取决于 tokenizer。没有新增 Tool 或 system prompt。

## 权限与限制

- 验证器只用 exact argv，不经 shell；临时 HOME 与 allowlist env 避免普通环境凭据继承；输出默认最多保留 64 KiB 文本并保留全量 hash。
- 配置是可信本地输入。子命令仍拥有外围 DSH Shell/Sandbox 允许的文件和网络权限；这不是 untrusted-code sandbox。
- 首版不会阻止模型错误地完成 Goal，不自动 push/创建 Draft PR，也未接入 Evolve outcome monitor。
- 没有前端，因此本纵切不触发浏览器 UI 验收要求。
- 当前真实 assembled/package boundary 在 macOS；Linux CI 执行纯 Git/类型/构建测试。

设计取舍见 [ADR-0012](../adr/0012-software-delivery-starts-with-skill-and-verifier.md)。
