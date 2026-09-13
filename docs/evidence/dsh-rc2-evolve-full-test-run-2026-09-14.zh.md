# Evolve rc.2 类型迁移与首次独立全量测试

- 日期：2026-09-14；EvoForge 起点 `1035303`。
- canonical DSH fetch 后 clean HEAD/origin/master 均为
  `c291e7961a515f6d7af9304e7fd1d257929aef26`，上游未修改。
- 使用[独立安装的 npm rc.2 副本](dsh-rc2-independent-install-2026-09-14.zh.md)，无旧 node_modules
  共享或类型/runtime aliases。npm 发布物不等同于 c291 逐字构建。

## 最后两组显式类型错误

Capability Gap Routing 与 Generation Binder 的专项测试初始 68 失败、5 通过，另有 2 个由夹具早退导致的
未处理 rejection。前者仍写旧 Assistant 引用，后者仍创建 v0 模板再送入当前 Session。

两者现使用原生格式的 Assistant helper；实际 Tool registry execute、body/result、pre-step gate 和
SessionStore 事件关系保持不变。Generation 模板也由实际 native format 构造，System prompt 在 v0 留于
request header，在 v3 使用固定 native source 的 System head。Brand 字段使用原生构造器。

测试推进按 inbox claim、两次 step/start/end 和 turn/end 的明确边界进行，不再靠旧整数推进新版日志。
正例回执仍检查两套固定物理序号，而不是从被测代码反算期望。多触发器负例的 Tool result 继续精确引用
各自 call；终末 Assistant 改用自身真实 chunks，避免被另一项无关的错误引用提前拒绝。
未删除或跳过原有乱序、合成事件、重复生命周期、权限/身份漂移和卸载失败用例。

两套依赖下专项各 73/73 通过；两套 `pnpm --filter dsh-evolve run typecheck` 均通过，包括
`tsconfig.test.json`。这是 Evolve 全类型检查，不代表全仓库所有包的测试已通过。

## 新版全量结果：仍失败

独立副本 Evolve 包目录执行：

```text
DSH_EVOLVE_DSH_SOURCE_DIR=<c291-checkout> node_modules/.bin/vitest run
```

结果为 85 个文件：78 通过、7 失败；1012 个测试：1003 通过、9 失败，exit 1。

- `interaction-trigger-request-control.test.ts`：2 失败，运行时隐藏的 v0 native Session 构造仍需迁移。
- `package-runtime-surface.test.ts`：1 失败，断言固定 alpha.5 peer，与候选 rc.2 manifest 不符。
- 五个 assembled Shadow/baseline 文件：6 失败。Capability-absent 两项明确报告当前 DSH revision 与
  case pack 锁定的 `db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5` 不一致；其余四项当前输出只显示
  incomplete，尚未在本轮分别确认详细原因。

不跳过失败，不放松 revision guard，不把旧治理 case pack 改写为新版结果。后续应按各自固定的环境复现，
并为新版独立建立可审计的验收配置。现在不能升级支持声明、发布或声称用户工作流验收完成。
正式依赖、运行中的单 Host、凭据、授权和历史均未改动。
