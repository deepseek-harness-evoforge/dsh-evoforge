# V5.131：飞书撤销路由修复后的 alpha.5 全仓回归

## 验证范围

最新 DSH `origin/master` 已先 fetch 并确认 clean、HEAD 与远端一致；随后使用项目已审计、可构建的 DSH alpha.5 support checkout `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` 运行：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d pnpm run check
```

## 结果

文档/公开路径、CI 测试路径、套件/发布合同、Hermes EV-1 与 Provider/Feishu acceptance contract、12 个 Bundle 的 typecheck、全部测试和全部构建通过。关键计数包括：`dsh-evolve` 69/309、Gateway 8/40、Telegram 8/29、Feishu 18/46；Control Center 2/5、Evolution Web 2/27、Attention 4/11 等均通过。仓库工作树保持 clean。

这只是当前代码与 alpha.5 的工程回归，不改变 release gate：最新 DSH master 的上游根级 tsdown 入口仍阻断 assembled 支持；真实 Feishu AS-2、真实 Provider、Hermes paired、长期效果和 npm 命名空间仍未满足发布条件。
