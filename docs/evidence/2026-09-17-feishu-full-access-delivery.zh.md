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

上述 transport 仍是测试实现，不能代替真实平台上传和下载验收。生产部署、实际文件回执与下载核对完成后另补本页；
目前不据此声明真实渠道已修复，也不声明 Hermes 优势或完整进化验收。
