# V5.92：Gateway 配对表单多挂载标识隔离

## 发现

统一 DSH `conversation.view` 已为 Control Center 的 tab/panel 使用实例化 ARIA id，但 Gateway Surface 的
配对码 `<input>` 仍固定为 `dsh-gateway-pairing-code`。DSH 在 Session 切换、恢复或宿主重新挂载期间可能
同时存在两个 Surface；固定 id 会让两个 `label` 关系不确定，读屏和键盘输入可能落到错误的 Session。

## 修复

- `GatewaySurface` 使用 React `useId()` 创建实例前缀，并以此前缀生成配对码 input id。
- `label[for]` 与 input id 在每个挂载内保持一一对应；没有新增路由、状态库、Session、Gateway 或页面。
- 新增双 Surface 回归测试，验证两个输入 id 唯一且各自存在对应 label。

## 验证

开发和测试前重新 fetch DSH，确认官方最新 `origin/master` 为
`76fda729799fe9b3848dbe2c211d4b231032b81e`，工作树 clean；运行时支持基线仍为可构建 alpha.5
`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`。

```sh
DSH_DIR=<path-to-deepseek-harness>
git -C "$DSH_DIR" fetch origin --tags --prune
test "$(git -C "$DSH_DIR" rev-parse HEAD)" = "$(git -C "$DSH_DIR" rev-parse origin/master)"
test -z "$(git -C "$DSH_DIR" status --short)"
pnpm --filter dsh-gateway typecheck
pnpm --filter dsh-gateway exec vitest run test/gateway-action.client.test.tsx --maxWorkers 1
pnpm --filter dsh-gateway build
git diff --check
```

结果：类型检查通过；Gateway Client Surface 定向测试 7/7 通过；产物构建及 Typert/artifact 校验通过。

## 真实浏览器边界

V5.92 同一轮已用 alpha.5 clean profile 在一个 DSH Web 标签中进入原生“控制台 → 渠道”并观察到 Gateway
Surface；浏览器标签数为 1，页面 DOM 的配对码控件由 Gateway 事实决定。该浏览器观察不把没有外部
Feishu pending request 的环境当作真实配对通过。

## 发布边界

这是多挂载可访问性和 Session 隔离修复，不是外部渠道、Provider、Hermes paired、长期效果或 release tag
通过证据；这些门仍按根目录 `release-gates.json` 保持原状态。
