# V5.16：DSH rc.5 / rc.2 双版本兼容矩阵

> 日期：2026-08-24
>
> 目标 A：DeepSeek Harness `0.1.0-rc.5`，revision `47f943859bef60e4160492346772ded9b24f765a`
>
> 目标 B：DeepSeek Harness `0.1.1-rc.2`，revision `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## 本增量解决了什么

V5.15 只完成 rc.2 一手源码审计，没有据此扩大支持。V5.16 新增可重放的双目标矩阵，并把所有 DSH peer
range 从宽泛预发布范围收紧为 exact `0.1.0-rc.5 || 0.1.1-rc.2`。矩阵入口先读取真实 Git revision、CLI
package version 和 tracked worktree 状态；未知 revision、版本错配或 tracked dirty 均在测试前失败。

红测暴露并修正了以下真实差异：

1. rc.2 `CommandRuntime.execute` 在 signal 前新增图片批次。Gateway 现在按公开函数签名向 rc.2 传空图片批次，
   rc.5 继续使用原三参数调用；渠道图片仍作为普通消息附件进入 Agent，不混入 slash Command。
2. rc.2 `AttachmentStore.saveImages()` 负责有序整批准入和规范化。飞书入站优先使用该 seam；rc.5 回退先验证
   全批再逐个保存。Gateway 保留并严格校验规范化引用的 `originalDimensions`。
3. rc.2 保存后的图片 bytes 与内容身份可能因规范化而变化。assembled 飞书用例现在验证 Session 引用与
   Host 实际存储 bytes 的 SHA-256 一致，不再错误要求等于平台原始 bytes。
4. rc.2 `LlmAdapter.prepareCall()` 把模型能力与一次 dispatch 绑定。内容审批与缓存组合 fixture 同时实现
   rc.5/rc.2 结构契约，使测试仍经过真实 rc.2 LLM Runtime，而不是跳过模型调用。
5. macOS `/tmp` 与 `/private/tmp` 别名曾让测试进程加载两份 DSH Tool 模块，内部 Scheduler `Symbol` 不同。
   Generation binder 先 canonicalize DSH 源路径，确保原生 Agent Loop 与 Tool Runtime 来自同一目标树。

## 可重放入口与通过结果

```sh
pnpm check:dsh-compatibility-script

DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/dsh-rc5 \
  pnpm test:dsh-compatibility

DSH_EVOLVE_DSH_SOURCE_DIR=/absolute/path/to/dsh-rc2 \
  pnpm test:dsh-compatibility
```

每个目标执行同一组门禁：

- 22 项十一包 Bundle/peer/无第二 Runtime 契约；
- 十一包最终 tarball 的 clean-profile add、dump、Host boot、原生 Session/Goal/Tool、dispose、remove、再次
  boot 与 Session/Goal readback；
- 冻结 V5.11 十一包→当前十一包的官方 CLI 原位升级、旧 Gap 读回、第二 Goal→Opportunity、无重复 Bundle、
  全卸载与两条原生 Session/Goal readback；
- 自然语言 Goal→真实 Agent Loop→`report_capability_gap`→持久 Gap，以及 internally authored / existing
  whole-Skill Generation 的 future-Session 固定和精确回滚；
- 飞书 assembled 聊天与图片、内容 Tool 的 exact native Approval、Telegram/飞书/Gateway/attention 全组合
  的请求字节等价与零额外模型表面。

两组目标均通过同一入口；每组 7 个测试文件、30 项测试全部通过。根级 `pnpm check` 另保留矩阵脚本自身的
3 项 allowlist/拒绝测试，防止未来把任意 DSH checkout 当成支持证据。

## 没有证明什么

- 没有真实飞书 App 凭据或人工消息；AS-2 仍为 `NOT_RUN`。
- 没有两套独立真实 Provider；RP-1 仍为 `NOT_RUN`。
- 没有同模型、同权限、同预算的 Hermes 长期 paired 结果，也没有长期误晋升、负迁移或误回滚率。
- rc.2 仍没有 generic file/audio/video 的 durable ref、Session block、provider、compaction 与 UI 全链契约。
- 这不是 registry release，也不满足首个 SemVer tag 的全部发布门；本增量不打 tag。
