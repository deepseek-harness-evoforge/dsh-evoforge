# V5.201：Gateway 启停竞态修复后的全量门复验

> 日期：2026-09-04。范围：在 V5.200 常驻 Gateway 启停竞态修复后，重新按最新 DSH canonical revision 执行 EvoForge 根级检查。

## DSH 基线

- canonical `origin/master`: `d347e703908d0406b7a7ef80e3a0e594d86b2215`
- 版本/tag: `0.1.3-alpha.1` / `dsh-v0.1.3-alpha.1`（tag 与 master 指向同一 revision）
- DSH 工作树：clean，`HEAD == origin/master`
- 官方安装：通过
- DSH 根构建：仍因上游 `@deepseek-ai/dsh-root` 缺失 `lib/types/{index,invariant,startup}.js` 阻断；未由 EvoForge 修改或掩盖
- EvoForge 可构建支持组合：alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`

## 命令与结果

```sh
DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/buildable-dsh-support pnpm run check
```

权威退出码：`CHECK_RC=0`。

- Evolution：`69` 个测试文件，`309/309` 通过
- Gateway：`8` 个测试文件，`46/46` 通过
- Feishu：`19` 个测试文件，`56/56` 通过
- Telegram：`11` 个测试文件，`38/38` 通过
- Evolve Web：`2` 个测试文件，`27/27` 通过
- Control Center：`2` 个测试文件，`5/5` 通过
- Doctor：`5` 个测试文件，`40/40` 通过
- Goal Continuity：`12/12` 通过；GitHub Review：`27/27` 通过
- Resident：`17` 通过、`1` 跳过（按既有外部授权门禁）
- Software Delivery：`34` 通过、`1` 跳过；clean-profile：`1` 通过、`1` 跳过
- Typert、Node artifact、Bundle/套件、兼容性、文档与发布脚本合同门：通过

新增的成功/失败启停竞态回归均在根级检查中执行；没有真实渠道消息、Provider 调用或凭据读写。

## 解释边界

这次全量通过证明 V5.200 没有破坏现有本地合同和生命周期门，不证明真实 Feishu/Telegram、真实 Provider、Hermes paired benchmark、长期负迁移/遗忘、npm ownership 或发布 tag 门禁已通过。发布门仍保持 blocked，不能据此宣称 Hermes 上位替代完成。
