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

### A-03（高）：Explorer 使用宽泛类型

ExplorerPage 的 repository 使用 Record<string, any>。建立最小 GitHub Repository DTO。

### A-04（高）：Pinia 可能未使用

Pinia 在 package.json 安装且 main.ts 初始化；已检查源码未发现 defineStore。完整搜索后决定移除，不迁移状态来证明依赖有用。

### A-05（高）：Vue SFC 检查缺口

ProjectsPage.vue 被 .prettierignore 排除；Biome 排除所有 Vue SFC。移除页面例外，补 Vue 模板/脚本 Lint。

### A-06（中）：质量脚本重复

lint 执行 Admin typecheck，typecheck 又执行 Worker + Admin typecheck；CI 顺序运行二者。分离 Lint 与 Typecheck 责任。

### A-07（中）：Prettier 未作为锁定依赖

Prettier 用 bunx --yes prettier@3.6.2 临时执行，未列为 devDependency。固定工具依赖版本。

### A-08（中）：GitHub API 类型过宽

Scanner/Actions 多处 gh<any>，外部 API 数据缺少窄 DTO。增加 DTO 与运行时守卫。

### A-09（中）：KV 多键并发语义

Storage 项目保存/删除使用多个 KV key 的读改写，没有跨键事务。明确并发风险，补幂等/并发测试。

### A-10（中）：部分 Service 职责密集

Service 已分层，但部分文件职责密集且格式紧凑。仅在测试或需求暴露维护成本时拆分。

### A-11（中）：部署文档漂移

功能分支 README 曾未同步主分支 CI/CD 改造。以单一 CI/CD 文档为部署事实源。

## 未证实 / 待验证

- [ ] 全仓搜索 Pinia Store 是否存在动态使用。
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

1. 取消 ProjectsPage 格式检查例外。
2. 分离 lint/typecheck，避免重复执行。
3. 固定 Prettier 依赖并补 Vue SFC Lint。
4. 运行全量 CI。

### P1：契约与边界

1. 收窄 Explorer GitHub Repository 类型与 Worker GitHub DTO。
2. 评估共享 API DTO。
3. 补 API 输入校验和异常测试。
4. 审查 KV 多键并发语义。

### P2：页面渐进重构

1. 补批量选择/批处理逻辑测试。
2. 抽离 Projects 批处理/选择逻辑。
3. 分离 Explorer 数据筛选/排序与 API 状态。
4. 依据真实复用情况抽组件。

### P3：体验验收

1. 浏览器 E2E/人工验收。
2. 桌面/移动端与可访问性检查。
3. 按路线图推进监控、文件和历史页面。

修复后必须关联 PR/commit；未运行测试不得从待验证改成通过。
