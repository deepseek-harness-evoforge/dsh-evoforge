# ADR-0020：Case Pack 必须先校准，再消费 proposer 预算

## 状态

Accepted，2026-08-16。

## 背景

Case Pack 的 evaluator 是 Candidate 晋升的独立真相来源，但“存在 evaluator 文件”不等于方向正确。
它必须拒绝 known-bad，并接受 known-correction。此前完整 Shadow 在 proposer 产生 Candidate 后才执行
四次 paired Trial；一个路径错误、输出错误或方向失准的 evaluator 可能浪费一次付费请求，用户也
缺少一个不生成 Candidate的独立 authoring 检查。

为此建立通用 Case SDK、服务或第二套 evaluator runtime 会增加配置与维护面。现有 macOS Sealed
Trial 已拥有需要的隔离、预算、DSH revision 和输出验证，应把它变成更深的内部模块。

## 决策

`dsh-evolve` 增加一个离线命令：

```text
dsh-evolve calibrate --case-pack <case-pack-dir> --output <new-run-dir>
```

它解析同一个 manifest，只运行 known-bad 与 known-correction 两次现有 Sealed Trial，写入
`calibration-report.json`。命令不读取 proposer route/API key、不创建 Candidate、不修改 Case Pack，
并明确记录模型调用与 token 为 0。输出必须是 Case Pack 外的新目录；输入在运行前后用 whole-tree
hash 验证。

完整 Shadow 也改变执行顺序，但不增加执行次数：

```text
known-bad + known-correction → proposer → baseline + Candidate
          2 次              1 请求         2 次
```

只要 manifest 同时声明 Trial 与 calibration，Shadow 就必须先完成两次校准。方向错误、平台缺少
sealed executor、预算不足或输入漂移时返回 `2 + incomplete`，且 proposer 调用为 0。校准通过后才
记录 paid-effect intent 并请求 Candidate；比较阶段仍使用同一 evaluator。完整成功运行的 Trial
count 保持 4。

为了不扩展 journal schema，preflight calibration 本身不持久化为可跨进程跳过的权威状态：它没有
外部网络效果，显式恢复可以安全重跑。Candidate 已 durable 后的恢复继续保守执行完整四次 paired
Trial，但不重复 proposer。独立 `calibrate` 命令也不成为 Shadow 的信任缓存；Case Pack 每次仍按
exact hash 验证。

## 结果

- Case Pack 作者可在花费模型预算、披露反馈或生成 Candidate 前验证 evaluator 方向；
- Shadow 默认把 deterministic gate 放在模型判断之前，失准 evaluator 的 proposer token 成本为 0；
- 一个 runner 同时服务校准与比较，没有新插件、Service、Schema、daemon 或正常 Session 表面；
- `calibrated` 只证明两个声明 fixture 的方向和隔离执行成立，不证明 evaluator 覆盖所有真实失败；
- 当前 sealed backend 仍只支持 macOS；Linux/Windows 返回 incomplete，不降级为不隔离执行。

