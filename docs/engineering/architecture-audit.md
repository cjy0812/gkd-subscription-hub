# 架构与工程审计

> 基线：2026-11-23，目标分支 feat/admin-ui-roadmap。静态代码审计；未运行本地构建、浏览器或生产验证。

## 结构概览

```text
apps/admin/        Vue 3 + Vite + Naive UI
src/               Cloudflare Worker + Hono
  middleware/      认证
  routes/          管理 API、Explorer、订阅分发
  services/        GitHub、扫描、预测、Explorer
  storage/         KV 项目元数据
  utils/           HTTP/内容协商/转义
test/              Vitest
docs/              技术设计、CI/CD、路线图、工程规范
.github/workflows/ CI 与手动生产 Smoke Test
```

## 已确认发现

### A-01（高）：页面职责过重

ProjectsPage.vue 约 775 行；ExplorerPage.vue 约 472 行，包含筛选、批量操作、API 和展示逻辑。建议先补行为测试，再按业务边界抽 composable/component；不按行数机械拆分。

### A-02（高）：前后端类型重复

src/types.ts 与 apps/admin/src/types.ts 重复 Project、DistFile、WorkflowInfo、WorkflowRun；Prediction / ProjectPrediction 命名不同。评估只共享 API DTO，不共享 Worker Env/内部类型。

### A-03（进行中，PR #26）：Explorer 使用宽泛类型

基线代码中 src/services/explorer.ts 的 Candidate 使用 Record<string, any>，GitHub Search、Commit、Tree 和 Rate Limit 响应也直接使用 any。PR #26 已改为 unknown + 运行时类型守卫并补测试，当前 CI 通过；仍待 PR 合并后从基线移除此项。

### A-04（已解决）：移除未使用的 Pinia

全仓库搜索 `defineStore` 无结果；`createPinia` 只在 `apps/admin/src/main.ts` 中用于初始化，没有 Store 定义或使用。已从 Admin 依赖、应用装配和锁文件移除 Pinia，不迁移状态、不引入替代状态库。详见 PR #28。

### A-05（中）：Vue SFC 工具覆盖仍需观察

已移除 Prettier 和 `.prettierignore`，不再存在 ProjectsPage.vue 的格式检查例外。仓库锁定的 Biome 2.6.8 启用实验性 HTML super-language 支持，对 Vue SFC 提供格式化与 Lint；该能力仍可能存在边缘语法/规则缺口，不能等同于完整 Vue 专属规则集。`vue-tsc` 继续负责模板/脚本类型检查。当前选择接受实验性覆盖，不额外引入 ESLint/Prettier；若 CI 或实际开发发现可复现缺口，再基于证据评估。

### A-06（已修复）：质量脚本重复

原先 format:check 使用 biome ci（同时运行 Formatter 和 Linter），后续 lint 再运行 biome lint；lint 还重复执行 Admin typecheck，而 typecheck 已执行 Worker + Admin typecheck。现已拆分为 biome format、biome lint 和独立 typecheck。修复提交 66a8aa3；CI Run #45084403707 与 #45084606662 均通过。

### A-08（中）：GitHub API 类型过宽

Scanner/Actions 仍有多处 gh<any>，外部 API 数据缺少窄 DTO。Explorer 服务的 any 已由 PR #26 改为 unknown + 类型守卫，仍需后续收窄 Scanner/Actions。

### A-09（中）：KV 多键并发语义

Storage 项目保存/删除使用多个 KV key 的读改写，没有跨键事务。明确并发风险，补幂等/并发测试。

### A-10（中）：部分 Service 职责密集

Service 已分层，但部分文件职责密集且格式紧凑。仅在测试或需求暴露维护成本时拆分。

### A-11（中）：部署文档漂移

功能分支 README 曾未同步主分支 CI/CD 改造。以单一 CI/CD 文档为部署事实源。

## 未证实 / 待验证

- [ ] 在 CI 中验证 Biome 2.6.8 对全部 Vue SFC 的格式化与 Lint；实验性支持的边缘语法/规则覆盖仍需观察。

- [ ] 执行 frozen install、format、lint、typecheck、Vitest、Admin build。
- [ ] 浏览器验证登录、401、批量跨筛选选择、部分失败和窄屏。
- [ ] 评估 Workers Vitest Integration 是否覆盖 workerd 差异。
- [ ] 验证 Cron/Webhook 同时刷新时 KV 索引是否丢失或旧数据覆盖。
- [ ] 检查 API 对畸形 JSON、缺字段和超大 body 的处理。
- [ ] 检查 Markdown 预览的内容安全、链接策略和缓存头。
- [ ] Cloudflare Dashboard 实际 Preview Secret/KV 设置尚未独立核实。
- [ ] 核对 README API/功能说明与当前实现。

## 优先级

### P0：质量门禁可信

1. [x] 删除 ProjectsPage.vue 格式检查例外，并移除 Prettier 配置。
2. [x] 分离 format/lint/typecheck，避免重复执行（提交 66a8aa3）。
3. [x] 移除临时下载的 Prettier 与独立配置；Biome 统一负责受支持文件格式化与 Lint，Vue SFC 保留实验性 Lint 和 vue-tsc 类型检查，暂不格式化。
4. [x] 全量 CI 已通过（Run #45084606662）。

### P1：契约与边界

1. [~] 收窄 Explorer GitHub API DTO（PR #26）；后续继续处理 Scanner/Actions。
2. 评估共享 API DTO。
3. 补 API 输入校验和异常测试。
4. 审查 KV 多键并发语义。

### P2：页面渐进重构

1. [x] 补充顺序批处理与批量选择纯函数测试；见 `apps/admin/src/batch.test.ts`、`apps/admin/src/selection.test.ts`。
2. [x] 将 Projects 页面选择集合更新规则抽离为可独立测试的纯函数；页面仍负责响应式状态和事件编排。
3. 分离 Explorer 数据筛选/排序与 API 状态（先确认边界与收益，再实施）。
4. 依据真实复用情况抽组件。

### P3：体验验收

1. 浏览器 E2E/人工验收。
2. 桌面/移动端与可访问性检查。
3. 按路线图推进监控、文件和历史页面。

修复后必须关联 PR/commit；未运行测试不得从待验证改成通过。
