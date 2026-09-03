# V5.98：AS-2 非交互启动不再制造多 URL 噪声

## 发现

真实 Feishu AS-2 为创建 Workspace、正式连接和 Host 重启会多次 boot DSH `web` profile。此前各次 boot 都传入
`--no-open`，不会自动打开浏览器，但 DSH `web-runtime` 仍打印临时 URL，用户容易误以为需要同时打开多个网页，
与项目“一个原生控制面”的产品约束相冲突。

## 修复

`writeAcceptanceOverlay` 为非交互 runner 覆盖 `web-runtime` 配置：

- `openBrowser: false`；
- `printUrl: false`；
- `surfaceContext: false`；
- 保留 Web 服务本身，继续支持 DSH 原生 Typert/RPC 组合。

该覆盖只存在于 AS-2 验收 overlay，不改变发布 Bundle、DSH 用户 profile 或正式 Web 控制面；没有新增页面、
Router、Gateway、Session、Agent Runtime 或状态库。

## 验证

开发和测试前重新 fetch DSH，确认官方最新远端 `origin/master` 为
`76fda729799fe9b3848dbe2c211d4b231032b81e`，工作树 clean；类型/合同验证使用审计的 alpha.5。

```sh
DSH_DIR=<path-to-deepseek-harness>
git -C "$DSH_DIR" fetch origin --tags --prune
test "$(git -C "$DSH_DIR" rev-parse HEAD)" = "$(git -C "$DSH_DIR" rev-parse origin/master)"
test -z "$(git -C "$DSH_DIR" status --short)"
pnpm run benchmark:feishu:as2:typecheck
pnpm run benchmark:feishu:as2:test
pnpm run check:docs
```

结果：AS-2 类型检查通过，合同测试 10/10 通过，文档检查通过。真实 Feishu AS-2 的 pending 事件门未因此改变。

## 发布边界

这是验收器输出与用户体验的降噪修复，不是真实 Feishu、Provider、Hermes paired、长期效果或 release tag 门通过
证据；根目录 `release-gates.json` 的真实渠道状态保持 `failed`。
