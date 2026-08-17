# KV-2 全套件 Composition Cache Contract 证据

> 状态：implemented evidence；固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`。
> 该门证明模型可见请求稳定，不冒充真实 provider 的 cache-read、TTFT 或账单数据。

## 用户结果

EvoForge 的后台状态、路由、平台身份、注意力消息和恢复策略不会悄悄进入当前 DSH Session 的 Prompt、
Tool Schema、Skill catalog 或消息前缀。唯一有意增加的模型表面是 Software Delivery 的固定 Skill/Tool；
它在 Session 内保持稳定，卸载后由 DSH lifecycle 移除。

## 统一门禁

```bash
pnpm test:cache-contract
```

该命令覆盖：

| 层 | 真实接缝 | 断言 |
|---|---|---|
| Evolution | 配置完整 host plane 的真实 Agent 连续 64 轮，并在第 33 轮前切换 future Generation | 64 个 provider request 与无 EvoForge 控制组逐项、逐字节相等；当前 Session 不切版本 |
| GitHub Review | 真实 DSH Host 启用 review poller | 无 actionable review 时完整正常请求与 native 相等 |
| Goal Continuity | JSONL 冷恢复、自动 rearm 与原生手工 resume | system、tools 和模型可见 messages 的 cache surface 相等 |
| Software Delivery | 原生 Skill Tool 与 `complete_delivery` Tool 的真实 Agent Loop | 固定 Tool 顺序/Schema 跨轮不变；Skill 按 DSH 原生路径加载；dispose 后表面移除 |
| Channels | 同一真实 Host、两个真实 Workspace、Router + Telegram + 飞书 + evolution attention 同时启用 | 两个 Agent 的完整 provider request 分别与对应 native Agent byte-equivalent；route、App、Workspace attention 动态值不泄漏 |
| 包边界 | 十一个发布包的 Bundle/manifest 合同 | 全部无产品 bin；DSH/Cordis 只在 peer/dev 边界；公开入口均由官方 Bundle 激活 |

渠道组合门在 fake Telegram HTTP 与 fake Feishu protocol 边界发送真实 durable attention，但模型请求仍
完全相等。这证明 host-only 插件组合没有通过“单包都说自己是零 token”来代替最终 provider 接缝测量。

## 限制

- 固定无密钥 Adapter 不能证明供应商实际给出多少 cache-read token、TTFT 改善或费用节省；
- Candidate Skill 内容变化本来就只允许进入未来 Session，本门不要求不同 Generation 的请求相等；
- 外部平台真实网络、移动端与多日运行属于渠道 soak，不属于 composition 等价证明。
