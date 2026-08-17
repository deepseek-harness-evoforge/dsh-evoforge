# EvoForge 路线图

> 状态：功能扩展冻结。DSH 原生插件产品形态与 clean-profile assembled contract 优先于全部旧里程碑。

## 当前唯一门禁

1. 六个发布包都能由目标 DSH/Cordis 直接加载；
2. 官方 Bundle/profile patch 是唯一安装与启用机制；
3. 没有独立 Runtime、产品 CLI、Web server、daemon、数据库、任务系统或 agent loop；
4. packed artifact 从官方 DSH CLI 安装到隔离 shipped profile；
5. `--dump-config` 只出现预期 EvoForge rows，Host 能启动；
6. 用户能力从真实 DSH Agent/Session/Goal 内触发并读写 DSH 权威接缝；
7. 禁用/卸载释放资源，原生 Host 和原生 Session/Goal 数据继续可用；
8. CI 固定目标 DSH revision，把上述路径作为硬门禁。

本轮代码和本地门禁已满足 1–7，CI 定义已包含第 8 项；hosted runner 结果尚未在本工作区产生。发布、merge、deploy 不在本轮范围。

## 冻结内容

在所有者重新排序前，不继续 LC-1、持续进化功能堆叠、新 CLI、新 Web 服务、新 daemon 或任何新产品能力。现有 P0/P1/P2/LC 实现仅作为插件内部代码保留；旧阶段资料位于 `docs/evidence/` 与历史 ADR，不再提供独立运行说明。

## 解冻条件

只有以下事实同时成立才讨论新功能：

- hosted CI 的 pinned clean-profile job 通过；
- 一名不了解仓库内部结构的用户能按安装文档完成安装、DSH 内使用和卸载；
- registry 发布决策、版本兼容矩阵和升级/回滚策略得到所有者明确授权。
