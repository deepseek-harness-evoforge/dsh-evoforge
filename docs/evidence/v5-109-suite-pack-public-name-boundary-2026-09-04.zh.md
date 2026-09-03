# V5.109：套件打包分离 workspace 目录与公开 npm 名称

日期：2026-09-04  
EvoForge：`main`  目标 DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`

## 发现

V5.107 已让 release 预检按 workspace 目录读取包文件，但 `pack-suites.mjs` 仍用目录名推导 tarball 文件名，
并把目录名写入套件的公开 `packages[].name`。当前十二个包都未加 npm Scope，所以普通路径没有暴露问题；一旦取得
项目所有权并迁移到 scoped npm 名称，`pnpm pack` 会按公开 manifest 名称生成文件，旧脚本会误报文件不存在，卸载清单
也会指向错误身份。

## 修正

套件脚本现在显式区分：

- `dir`：workspace 目录和 pnpm filter 的内部身份；
- `name`：package.json 的公开 npm/DSH 安装身份；
- `filename`：由公开名称规范化后生成的 tarball 文件名。

Bundle patch 中稳定的 Cordis row id/name 不由打包脚本重写。这样未来迁移到项目拥有的 npm Scope 时，只需要在授权
后更新 manifest、依赖和矩阵，不会因打包器把目录名当作公开包名而产生静默错误。

## DSH 前置审计

```text
DSH_HEAD=76fda729799fe9b3848dbe2c211d4b231032b81e
DSH_MASTER=76fda729799fe9b3848dbe2c211d4b231032b81e
DSH_VERSION=0.1.2-rc.1
DSH_STATUS=<empty>
```

## 验证

```text
node --test scripts/pack-suites.test.mjs scripts/suite-manifest.test.mjs  # 4/4 passed
pnpm run check:docs                                                       # passed
pnpm run pack:suite -- --suite core --out /tmp/evoforge-pack.apjzFe       # passed
```

实际生成四个 core tarball 和 `evoforge-suite.json`；当前公开名称仍为未加 Scope 的临时名称，npm 归属门仍保持阻塞，
没有未经授权地改名或创建 tag。
