# P0C.5 证据：Review Protected-effect Projection

> 日期：2026-08-16  
> 声明等级：`implemented`；这是保守词法提示，不是语义安全证明或权限执行器

## 用户结果

`/evolve review <64-char-review-id>` 在 exact diff 前新增固定、可解释的 host-only 信息：

```text
Protected-effect projection (lexical-protected-effects-v1; lexical only): scope append-only-skill; indicators credential-access, network-access
DSH Approval remains authoritative; no lexical indicator is a safety proof.
```

用户无需开启自动晋升、调用模型或批准 Candidate，即可看到变更是否提及 artifact scope、凭据、
破坏性动作、消息/日程、网络、付费、权限/沙箱、特权工具、生产变更或重写指令。

## 权威性与简单性

- 输入复用 `CandidatePublisher` 已验证的 exact Git baseline 和 sealed proposal；
- 单一 `SKILL.md` append 只扫描新增后缀，避免 baseline 自带词汇造成噪声；
- 改写 Skill 或增加其他 artifact 时显式标为 `broader-change`；
- detector 与 P1.1 auto-promotion policy 共用，避免 review/automation 规则漂移；
- 否定句仍提示 protected term，`none detected` 也不宣称安全；
- 无新 daemon、队列、数据库、Tool、Prompt、Schema、网络或模型 judge。

## 可复核测试

```bash
pnpm --filter dsh-evolve exec vitest run \
  test/candidate-impact.test.ts \
  test/candidate-publisher.test.ts \
  test/auto-promotion-policy.test.ts \
  test/evolve-command.test.ts \
  test/generation-binder.e2e.test.ts

pnpm check
```

覆盖内容：安全 append 无 indicator；KV Cache/token 文案不误判为凭据；明确 API key/network/deploy
分类；结构扩大/改写分类；否定句不消失；exact publisher 集成；host command 呈现；固定 revision
assembled DSH Commands/Agent 路径保持零额外模型请求。

本地完整结果：`dsh-evolve` 121 passed / 2 skipped，`dsh-software-delivery` 26 passed / 1 skipped；
合计 147 passed / 3 skipped，typecheck、build 与文档门通过。

功能提交 `645352a32baae6804f7dad59a90e7d519b02472f` 的公开
[CI run 31954087967](https://github.com/deepseek-harness-evoforge/dsh-evoforge/actions/runs/31954087967)
通过 Node 22.19.0、Node 24 和 macOS pinned-DSH assembled 三个 job。

## KV Cache 与成本

- 正常 Session 新增 Tool/Prompt/Skill catalog：0；
- 正常 Session 新增 token：0；
- review detail 模型请求：0；
- 新增持久内容副本：0；
- 计算范围：一次 review 时的本地字符串扫描，输出类别有界且顺序固定。

## 当前限制

- 词法规则会有误报与漏报，不能理解否定、参数、数据流或实际 capability；
- 规则只看 proposal 改变的文本，不替代 exact diff、人工判断或 DSH 原生权限；
- 尚无普通用户可用性试验，不能证明这些类别已经足够或排序最优；
- 没有新增分页、折叠、Web/TUI 或通用 Control Center。
