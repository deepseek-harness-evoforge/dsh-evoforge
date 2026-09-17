# 飞书完全访问文件交付修复

日期：2026-09-17。范围：默认关闭的文件交付启用后，将当前原生完全访问权限接入已认证飞书 turn；不修改用户权限、
凭据、配对、Session 格式或 DSH 核心。合同见 ADR-0105。

## 本地及原生组合证据

- 支持 Host：DSH `0.1.6-alpha.1` / `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`；本轮独立 fetch、安装和构建已通过。
- 修复前，新增 5 条 full-access 原生组合用例全部失败：预期一个文件，实际零个；不是 fixture 启动失败。
- 修复后 `DSH_FEISHU_TEST_NATIVE_FILES=1 DSH_EVOLVE_DSH_SOURCE_DIR=<audited-host> pnpm exec vitest run --maxWorkers 1`
  在 `packages/dsh-feishu` 通过 28 文件、148 测试。之后增加旧 description 恢复测试，窄回归 3 文件、46 测试通过。
- 窄回归覆盖 `file-tool.test.ts`、`dsh-assembled-file.e2e.test.ts`、`package-install-remove.e2e.test.ts`；原生组合覆盖
  routes、pairing、显式工具、原生 present、旧 header、拒绝和错误用户；安装测试使用干净 profile 并完成移除。
- full-access 负例：Web 发起、自定义同名但不同配置、缺失 provider、原生 guard、快照中撤权、渠道变化、接收方变化、
  取消及卸载均不提交。原生 Approval 路径不变。请求中的工具列表跨步骤保持一致，旧 description 和参数保持不变。
- Feishu build、typecheck、`pnpm peers check`、`pnpm run check:docs`、`git diff --check` 全部通过。
- 官方 `dsh:install -- --suite product --profile web` 在隔离预检 home 完成打包、add 和 dump，持久产物保留。

## 真实部署与平台下载

- 修复提交 `ee95c44` 已推送 main；安装产物为 product `b1cc477bb85f6aa8d9b0756d8098d0813b649f02a62057532b9364e0ac0e7e59`。
- 停止已核实的唯一旧 Host 后冷备份 profiles/sessions；官方 add 七包及私有 dump 通过。升级后 22 个 Session 文件
  逐字节相同，原 profile patch 逐字节相同。未更改凭据、配对、完全访问或 `approval: never`。
- `FEISHU-20260917-C4` 在原 DSH 私聊请求同一份虚构表；真实模型调用原生 `read` 与 `present`，turn 以 completed 结束。
  工具结果包含 `authorization: native-full-access` 和 `delivered: true`，该 turn 没有 approval/asked 或 approval/decided。
- 飞书实际出现 `evoforge-feishu-acceptance-result.md`、131 Byte 的文件气泡；预览表格为林/完成登录页文案/周三、
  周/补齐退款说明/周四。通过飞书下载按钮保存到本机，再以 `shasum -a 256` 比较下载与源文件，二者均为
  `980434b0776b633935e9a582a728e49bb71e249e394bb0734ed35d3179d0c16b`。
- Gateway durable 文件账本为一个 delivered、attempts=1；随后再次冷停并启动同一 profile，未重发文件。
  同一 Web 页刷新后恢复 C4 结果，并显示当前完全权限。页面记录本轮 16 秒、31.2K tok；这不是费用或性能优势声明。
- 冷重启后真实飞书 C5 要求仅回读、不重发；原生记录只有 read 调用且 completed，飞书回复林：周三、周：周四。
  文件账本仍为同一条 delivered、attempts=1；原生完全访问与 never 保持不变。

本页证明此 exact 真实渠道交付修复；不声明其他所有文件类型、Hermes 优势或完整进化验收。
