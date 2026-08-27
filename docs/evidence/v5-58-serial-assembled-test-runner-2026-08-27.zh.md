# V5.58：assembled 软件交付测试串行化

## 问题

根 `pnpm test` 原先把 `dsh-software-delivery` 与其它包并行执行。该包的 clean-profile/upgrade 测试会在
测试过程中为十二个插件运行 `pnpm pack`，而其它插件的 `pretest` 也会并行重建同一 `dist/lib` 产物；在
macOS 上这会造成临时 tarball 或 DSH Host 启动阶段竞争，表现为 180 秒/420 秒超时，而非业务断言失败。

## 修复

- 根测试批次不再并行执行 `dsh-software-delivery`。
- 新增 `pnpm test:software-delivery`：先以单 worker 跑 7 个快速/单包测试，再以单 worker 串行跑
  `clean-profile-suite.e2e.test.ts` 和 `suite-upgrade.e2e.test.ts`。
- 其它包仍可并行验证；Telegram/Feishu 的既有独立批次不变。

## 验证

- 7 个软件交付非 assembled 测试文件：34 passed、1 skipped，约 8 秒。
- 两个 assembled 文件单 worker：2/2 passed，约 121 秒。
- 首次失败的根批次已定位为 runner 并发路径；修复只改变测试编排，不放宽任何断言、超时或发布门。

## 边界

这只保证本地根测试的构建/打包可重复，不替代 clean-profile、真实飞书、真实 Provider、Hermes paired 或
长期效果证据。发布前仍需在干净 CI runner 和同条件预算下重跑所有外部门禁。
