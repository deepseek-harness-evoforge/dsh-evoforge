# UI-1 可解释审查卡证据

- 日期：2026-08-17
- 状态：`implemented`；真实 Chrome 交互通过，陌生用户可用性仍待验证
- 用户问题：进入候选详情后，队列里的改进主张会消失，而且判定理由、限制和变更范围不可见，操作者无法仅凭详情解释“为什么更好、改了什么、证据边界在哪里”。

## 最小改动

`dsh-evolve-web` 的现有 review detail 直接投影权威 `EvolutionReview`，新增显示：

- 改进主张；
- exact Skill 与 changed files；
- evaluator 判定理由与已知限制；
- baseline → Candidate case、token 成本、protected-effect 词法提示和 verified bounded diff。

没有新增状态模型、Remote method、审批阶段、后台任务或通用 UI 平台。approve/reject 成功后关闭旧详情并刷新权威 overview，避免仍显示可重复点击的过期审批表单。Promotion 仍是独立动作。

## Test-first 与浏览器证据

组件测试先证明详情缺失主张、文件、理由和限制，再加入投影；第二条失败断言证明 approve 成功后审批表单仍残留，再收敛为关闭详情。`dsh-evolve-web` 最终为 9/9 测试通过，TypeScript 检查通过。

仓库浏览器 fixture 复用产品 `cssText` 和最小 DSH theme variables，不用临时 CSS 冒充产品布局。真实已登录 Chrome 完成：

1. 打开 `Evolution`，看到一条待审查 Candidate；
2. `Inspect` 后同时看到 claim、`SKILL.md`、两条 decision reasons、一个 limitation、`fail → pass 2/2`、token、protected-effect indicators 与 verified diff；
3. 填写 decision note，确认 inactive publication 文案后批准；
4. 刷新结果显示 `No reviews`，decision note 不再存在；
5. 浏览器控制台 error 数为 `0`。

浏览器仅使用公开 Remote seam；测试页没有 Session、模型或秘密。

全仓 `pnpm check` 通过：Doctor 5/5、Software Delivery 26 passed / 1 skipped、Telegram 37/37、Evolve 170 passed / 2 skipped、Web 9/9；文档链接、所有包 typecheck/build 和 `git diff --check` 同时通过。

## KV Cache、权限和持久状态

- 模型表面变化：`none`；没有 Tool、Prompt、Skill、system message 或 Session event；
- 正常 Session token 增量：`0`；
- 缓存影响：`none`；只有用户打开详情时读取既有 bounded host evidence；
- 新权限：`none`；approve 仍只发布 inactive Generation，promotion 保持独立；
- 新持久状态：`none`；浏览器不是第二真相源；
- 卸载变化：`none`；仍由 `dsh-evolve-web` Bundle 删除。

## 未证明

这份证据证明现有审查信息已经完整投影且审批后的交互状态不陈旧，不证明普通用户无需指导即可判断 Candidate，也不把 lexical protected-effect indicators 当作语义安全证明。真实陌生用户的完成时长、误操作和理解准确率仍是 `UI-1 verified` 的退出门。
