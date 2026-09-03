# V5.111：最新 DSH 基线上的 core clean-profile 安装回归

日期：2026-09-04  
EvoForge：`main`  
DSH 观察目标：`76fda729799fe9b3848dbe2c211d4b231032b81e`（`0.1.2-rc.1`）  
运行基线：可完整构建的 DSH alpha.5 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`

## 目的

V5.109 改动了套件清单中 workspace 目录与公开包名的表示。除静态打包外，必须重新走一次真实 DSH clean profile，
确认这类元数据改动没有破坏官方 `add/dump/boot/remove/readback` 生命周期，也没有引入第二套安装或 Runtime。

## DSH 前置审计

```text
DSH_HEAD=76fda729799fe9b3848dbe2c211d4b231032b81e
DSH_MASTER=76fda729799fe9b3848dbe2c211d4b231032b81e
DSH_VERSION=0.1.2-rc.1
DSH_STATUS=<empty>
```

最新 rc.1/master 的官方根级构建仍有上游 tsdown 入口缺陷，因此 assembled 运行继续使用已审计 alpha.5，且没有
修改 DSH checkout。

## 验证

```text
DSH_EVOLVE_DSH_SOURCE_DIR=/private/tmp/evoforge-dsh-latest.qPqo1d \
  pnpm --filter dsh-software-delivery exec vitest run \
  test/clean-profile-suite.e2e.test.ts --maxWorkers 1
```

结果：`1` 个测试文件、`1` 个测试通过，耗时约 `30.23s`。该测试从最终 tarball 安装 core/maintainer 组合，使用
官方 DSH Profile dump 和 Host boot，执行真实 Session/Goal/Storage/Tool 路径，再 dispose、官方 remove、再次
启动并 readback 原生持久化；工作树保持 clean。它只证明本地 alpha.5 生命周期回归，不提升真实飞书、Provider、
Hermes paired、长期效果或 npm 发布门状态。
