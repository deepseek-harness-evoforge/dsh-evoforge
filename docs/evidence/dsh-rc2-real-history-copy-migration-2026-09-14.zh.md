# 实际会话副本：官方 rc.2 迁移与重新打开

- 日期：2026-09-14；EvoForge 起点 `0559970f1b13c5b6ac10c85f7ce422e6194629eb`。
- 运行中的 Host：PID 40511，alpha.5 CLI，web profile，127.0.0.1:3000；本轮没有切换或重启它。
- 验证器：已构建的 c291e7961a515f6d7af9304e7fd1d257929aef26 JSONL backend，0.1.5-rc.2。

## 隐私与范围

只读取本机 DSH sessions，输出聚合计数，不输出会话 id、正文、消息内容或业务文件路径。
临时副本位于权限受限的本地 `.real-history-migration.M3eLqe`，不入 Git、不上传。
没有复制凭据、profile 或 Storage，也没有启动第二个 Host、AgentLoop 或渠道连接。
会话副本由官方 backend 迁移，不改写原始会话，不由 EvoForge 自建迁移器。

## 只读结构扫描

18 份文件全部是 v0、Zstandard 多帧日志。使用旧版官方 `scanZstdFrames` 分帧后逐帧解码，
完整扫描 659 条物理记录；无解码失败、无 torn frame、无首个 step 前的 surface append。
9 份没有 step。物理记录包括历史 packed chunk，不把物理行数称为逻辑事件数。

初次直接调用单次 Zstandard 解压只得到首帧 header，不能据此声称历史为空；上述结果已改为完整多帧扫描。

## 官方迁移结果

对每个原文件记录 SHA-256，复制后校验相等。新版 `sessionPersistence.list()` 返回 snapshot，
从 `snapshot.header.id` 取得 id 后执行：

1. 所有副本 `open(id, 'read')`、`read()`、`close()`；确认没有生成 v3 文件。
2. 所有副本 `open(id, 'write')`、`read()`、`close()`；逻辑事件摘要与只读迁移结果完全一致。
3. dispose backend Context，再创建新的 Context 打开副本；逻辑事件摘要仍完全一致。
4. 再次校验全部原文件、全部保留 v0 副本的 SHA-256。

最终本地探针 `node <private-temporary-root>/probe.mjs` exit 0：

```json
{"copied":18,"listed":18,"readPassed":18,"readRefused":0,"writePassed":18,"writeRefused":0,"sourceUnchanged":18,"retainedCopyUnchanged":18,"failures":{},"coldReadPassed":18}
```

`coldReadPassed` 指 dispose 后新建 Context 的回读，不是 OS 进程重启或完整 Agent 恢复。
初版探针误把 list snapshot 当 header，导致 undefined id 的 TypeError；纠正后在全新副本重跑，
此错误不属于 DSH 迁移拒绝，不计入最终结果。

## 结论与未完成项

当前 18 份实际日志的副本可通过官方迁移与重新打开，之前的最小早期 surface 反例没有在此样本触发。
这不保证运行期间新增历史、所有未来日志、业务 Storage、权限引用、EvoForge receipt 坐标或完整 profile 升级兼容。
保留旧 generation 也不等于写入新版后可无损自动降级。
正式依赖/支持范围和生产 Host 本轮未改变；下一步应核对 profile/插件状态与回滚方案，再做受控部署验收。
