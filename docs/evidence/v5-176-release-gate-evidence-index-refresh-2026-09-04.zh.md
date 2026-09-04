# V5.176：发布门禁证据索引刷新

日期：2026-09-04  
EvoForge revision：工作树基于 `4a48697`（本轮索引变更随后原子提交）

## 变更

发布门禁清单仍然保持原有状态和阻断条件，只补齐本轮已完成证据的引用：

- `public-package-preflight` 增加公开套件打包/单页验收证据 V5.173；
- `clean-profile-lifecycle` 增加完整 alpha.5 全仓回归证据 V5.175；
- `web-control-plane` 增加最新 DSH 单页控制中心证据 V5.173；
- `hermes-paired` 增加当前 Hermes EV-1 epoch-4 确定性 paired 证据 V5.174。

没有把 fixture、确定性 benchmark 或全仓单测转换成真实渠道、Provider、Hermes 模型 paired 或长期效果通过。
没有创建 SemVer tag。

## 验证

```text
node -e "JSON.parse(require('fs').readFileSync('release-gates.json','utf8'))"
pnpm run check:release:gates:test
pnpm run check:release:gates -- --json
```

清单结构和证据路径测试 `3/3` 通过，`missingEvidence` 为空；门禁汇总仍为 `blocked`，阻断项仍为 npm 归属、
真实 Telegram、真实 Feishu AS-2、真实 Provider、完整 Hermes 同条件模型 paired 和长期效果。
