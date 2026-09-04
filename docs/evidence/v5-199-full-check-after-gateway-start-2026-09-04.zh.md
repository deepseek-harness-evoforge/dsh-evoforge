# V5.199：Gateway 启动幂等修复后的全量复验

> 日期：2026-09-04。范围：在 V5.198 并发启动修复提交后，重新同步最新 DSH 并执行完整 EvoForge 检查。

## 结果

开发/测试前 canonical DSH 仍为 `origin/master` `d347e703908d0406b7a7ef80e3a0e594d86b2215`
（`0.1.3-alpha.1`），checkout clean 且 HEAD 与远端一致；官方安装退出码 `0`。DSH 根构建继续因上游
`@deepseek-ai/dsh-root` 缺失 `lib/types/{index,invariant,startup}.js` 入口而被分类为
`blocked-upstream-root-types-entry`，没有修改 DSH 源码。

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/buildable-dsh-support pnpm run check
```

权威结果：`CHECK_RC=0`。测试计数如下：

- Evolution `309/309`；Gateway `44/44`；Feishu `56/56`；Telegram `38/38`。
- Evolve Web `27/27`；Control Center `27/27`；Doctor `40/40`；Evolve Attention `11/11`。
- Resident `17 passed / 1 skipped`；Software Delivery `34 passed / 1 skipped`，clean-profile `1 passed / 1 skipped`。
- DSH preflight、文档、CI、套件/打包、Typert、兼容性、Provider/Feishu/Telegram 合同类型检查和发布脚本门均通过。

完整发布门仍保持 `blocked`：真实外部渠道、双真实 Provider、同条件 Hermes paired、长期效果与 npm 所有权证据没有被本地全量检查替代。

