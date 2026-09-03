# V5.110：npm 仓库归属检查的 URL 规范化

日期：2026-09-04  
EvoForge：`main`  目标 DSH：`76fda729799fe9b3848dbe2c211d4b231032b81e`

## 发现

`npm view --json` 返回的 `repository` 字段可能把同一 GitHub 仓库表示为 `git+https://…git`、普通 HTTPS 或
scp 风格 SSH。名称门禁原先使用精确字符串比较；项目取得 npm Scope 并发布第一个包后，registry 可能返回等价但
格式不同的 URL，导致自有包被误判为 collision，阻断合法发布。

## 修正

新增 `sameRepository()`：仅解析 GitHub host，去除 `git+`、`.git` 和首尾斜杠，并把 scp 风格转换为 HTTPS 后比较
owner/repository 路径。不同 host、不同路径、缺失或无法解析的仓库仍不被视为 owned，保持 fail closed。输出仍保留
registry 的原始 URL，方便审计。

## DSH 前置审计

```text
DSH_HEAD=76fda729799fe9b3848dbe2c211d4b231032b81e
DSH_MASTER=76fda729799fe9b3848dbe2c211d4b231032b81e
DSH_VERSION=0.1.2-rc.1
DSH_STATUS=<empty>
```

## 验证

```text
node --test scripts/check-npm-package-names.test.mjs  # 6/6 passed
pnpm run check:docs                                  # passed
```

线上四个未归属包名的冲突事实没有改变；本修正只消除同仓库 URL 格式差异造成的误阻断，不放宽命名空间授权要求，
也没有创建 tag。
