# V5.118：Feishu AS-2 overlay 行替换回归契约

## 结果

为避免 V5.114 的 Loader 冲突再次回归，AS-2 合同新增静态结构门：验收 overlay 必须把 DSH Web 已有的
`web-runtime` 作为顶层同 `id` 行替换，并且只能把 mock LLM、Schedule、Gateway、Feishu 等 benchmark 行放入独立
`insert` 列表；`insert` 列表内不得出现 `web-runtime`。这锁定了 DSH 官方“后层按 id 覆盖整行”的组合语义。

## 验证

在 canonical DSH 最新 master fetch/clean preflight 后执行：

```text
pnpm run benchmark:feishu:as2:check
```

结果：AS-2 类型检查通过，安全/输入/终态合同 `11/11` 通过。该检查不读取真实凭据、不连接飞书，也不产生外部
效果；真实 AS-2 仍需由独立 run root 和真实私聊完成。

## 未完成门禁

本轮只增加验收结构保护，不改变运行时。真实 Feishu AS-2、真实 Provider、Hermes paired、长期效果、外部 Telegram
和 npm 命名空间仍未通过。
