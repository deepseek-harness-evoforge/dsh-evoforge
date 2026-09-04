# V5.154：用户安装文档收口为单网页启动

日期：2026-09-04  
EvoForge 测试源码 revision：`82e2267463db96397e27ec3adc03a3d945805a22`  
Canonical DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`，`0.1.2-rc.1`，clean。

## 修正

根 README、中文上手指南和能力套件说明现在统一使用 `dsh --profile web --no-open` 启动示例，并明确：

- DSH Host 只启动一次；启动日志打印的 URL 复用到已有浏览器标签页；刷新使用浏览器 reload，不重新执行 Host；
- `dsh-resident` 默认追加 `--no-open`，崩溃恢复不会创建重复页面；
- 只有显式 `noOpen: false` 才请求每次启动的浏览器交接；
- 用户可见的当前支持目标固定为 DSH `0.1.2-alpha.5` 和对应 revision，避免将未通过支持矩阵的最新 rc 混装。

## 验证

执行 `pnpm run check:docs` 和 `git diff --check`，均通过。该变更只修正文档入口，不改变 DSH、Gateway、
Session、Goal、Web Surface 或外部渠道行为；真实渠道、Provider、Hermes paired、长期效果和 npm 发布门状态不变。
