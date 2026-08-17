# LC-1 原生 Goal 冷恢复接续

## 用户结果

对于把一个 DSH Agent 绑定到固定持久 Session 的单机用户，`dsh-goal-continuity` 把“进程重启后仍为
active、但按 DSH 安全语义已 disarm 的原生 Goal”变成“在明确部署授权和原有轮次上限内自动 rearm，
继续使用原生 `goal-round-driver`”。用户无需在每次受控重启或崩溃恢复后手工执行一次 `/goal resume`。

## 最小契约

- 唯一公开配置是最多 50 个 exact `autoResumeSessionIds`；空数组为默认值，也表示没有自动付费授权；
- 只处理 `agent/session-start.source === 'resume'`，不扫描持久化目录，不创建或选择 Session；
- 只 rearm `phase === 'active'` 且仍有原生 `maxGoalRounds` 容量的 Goal；paused、blocked、complete 保持不变；
- 只调用原生 `GoalService.resume`，新 revision 和 activation 仍由 Session log/Goal fold 权威记录；
- 后续轮次、完成、阻塞、权限和取消继续由 DSH 原生 Goal、Tool、Approval 与 `goal-round-driver` 决定。

```text
OS restarts DSH
      │
      ▼
native fixed Session restore
      │ agent/session-start(resume)
      ▼
exact static allowlist ── no ──> remain disarmed
      │ yes
      ▼
active + rounds remain ── no ──> preserve phase
      │ yes
      ▼
native GoalService.resume
      │
      ▼
existing goal-round-driver
```

## Cache、成本与权限

插件不注册 Tool、Skill、Prompt、Command、Remote、timer、watcher 或新 Service，正常 Session composition
增量为零。实际接续时模型只看到 DSH 已有、append-only 的 `<goal_round>`，与人工 `/goal resume` 完全相同；
已持久化的会话前缀不被重写。

rearm 可能触发新的 provider 请求，因此属于付费授权。安装包默认 disabled，启用后仍必须显式配置 exact
Session allowlist；总轮数继续受 Goal 自身的 durable `maxGoalRounds` 限制。插件不扩大 shell、文件、网络、
merge、release、部署、秘密或不可逆动作权限。

## 非目标

- 不实现 Mission、任务 DAG、通用 daemon、持久队列、退避重试器或新预算账本；
- 不替代 OS 服务管理器、Session Persistence、Agent Loop 或 `goal-round-driver`；
- 不自动恢复 paused/blocked Goal，不在同一进程内重试 provider/persistence 失败；
- 不扫描任意冷 Session，不猜测哪个 Goal 应继续；
- 不承诺多机 High Availability，也不把单机恢复称为高可用。
