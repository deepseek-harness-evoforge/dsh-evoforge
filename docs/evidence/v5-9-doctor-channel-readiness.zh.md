# V5.9：Doctor 渠道连接就绪诊断

> 日期：2026-08-24；固定 DSH revision：`47f943859bef60e4160492346772ded9b24f765a`；
> 状态：implemented；真实平台状态不变

## 用户结果

`/doctor` 不再只因 `dsh-feishu` 或 `dsh-telegram` 的 Cordis fiber active 就声称整套组合 READY。若这两个
Adapter 被列为必需模块，Doctor 会在命令执行时读取现有 `dsh-gateway` 的脱敏 transport 健康事实，并独立显示
连接缺失、连接中、ready、degraded 或 stopping。用户可以区分“插件已经装载”和“渠道现在确实可用”。

## 边界

- Loader 是插件安装、启停和 fiber phase 的唯一权威；Gateway 是 transport 状态的唯一权威；
- Doctor 只拥有三态归约和可执行说明，不建立健康数据库、轮询器、监控服务、Remote、Tool 或修复动作；
- 只诊断配置中 exact required 且当前 active 的飞书/Telegram Adapter；其他渠道不预建空壳；
- 无对应 transport、Gateway 缺失、抛错或快照损坏均 fail closed 为 unavailable；
- 任一对应 transport degraded 即 NOT READY；Gateway ready 且全部对应 transport ready 才通过；
  connecting/stopping/lifecycle 未稳定时为 UNKNOWN；
- 输出不包含 App、chat、user、credential、平台错误正文或 transport id。

## TDD 与最终包证据

red→green 依次观察并修复了：degraded 飞书被误报 READY、Command 未读取 Gateway、缺失 transport 没有诊断、
ready 没有显式 check、connecting 没有 UNKNOWN、Telegram 未走同一接缝，以及损坏 snapshot 导致 `/doctor`
抛出 TypeError。

`dsh-doctor` 的 35 个测试现覆盖纯归约、真实 Cordis Loader/Commands 和最终包边界。最终
`dsh-doctor-0.1.0-alpha.1.tgz` 通过官方 DSH CLI 加入隔离 profile，`--dump-config` 可见；真实 DSH Loader
先从测试专用 Adapter 观察 degraded，Cordis 原位 reload 后观察 ready，dispose/remove 后 package manifest 与
Bundle 列表恢复为空。测试 Adapter 只提供生产 Gateway 同形的脱敏服务以确定性制造故障/恢复，不是飞书平台
替身，也不能把 AS-2 的 `NOT_RUN` 改写成通过。

根级 `pnpm check` 通过：文档链接/公开路径、RP-1 8/8、AS-2 7/7、11 包 typecheck、workspace
552 passed/3 skipped 和 11 包 build 全绿。该命令没有获得真实 Provider/飞书执行授权，也没有发起外部请求。

## 尚未证明

本增量没有连接飞书或 Telegram，没有读取凭据或发出外部请求。真实飞书 direct/group 仍为 `NOT_RUN`，真实
Telegram Bot、长期重连、陌生安装可用性和 Hermes 同模型消息 paired benchmark 仍未完成；因此不创建 tag、
不发布 v0.1，也不宣称 Hermes 上位替代已经完成。
