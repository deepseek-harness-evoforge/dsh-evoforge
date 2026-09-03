# V5.113：Generation cache 跨进程恢复验证

日期：2026-09-04  
EvoForge：`main`  
目标 DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`

## 目的

自我进化 Candidate 使用内容寻址目录保存 Skill Bundle。此前测试覆盖首次 publish/materialize 和权限篡改拒绝，
但没有直接证明新的 `GenerationBundleRepository` 实例能够读取带嵌套 `references/` 的已有 immutable cache。缺少这条
证据会把“当前进程能用”误当成“Host 重启后仍能用”。

## 验证

在最新 DSH fetch/clean 前置后，`candidate-publisher` 测试新增恢复步骤：同一 generation 首次 provider materialize
完成后，创建全新的 `GenerationBundleRepository`，再次 `providerFor`、列出 Skill 并读取正文。测试 fixture 含
`references/evidence.md` 嵌套目录，覆盖 owner marker、目录只读、文件清单和内容哈希校验。

```text
pnpm --filter dsh-evolve exec vitest run test/candidate-publisher.test.ts --maxWorkers 1
Test Files  1 passed (1)
Tests       8 passed (8)
```

该验证增强了跨进程 cache/readback 证据，但不替代完整 DSH Session/Goal 恢复、真实 Provider、Hermes paired 或长期效果门。
