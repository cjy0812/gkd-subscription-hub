# 工程标准

> 初版基线：2026-11-23。与代码现状不一致的项目见架构审计。

## 工程原则

- 模块化单体优先；没有独立部署、扩展或团队边界需求，不拆微服务。
- 渐进式演进；先证明边界和收益，再拆模块，不为目录整齐进行大规模搬迁。
- 运行时事实优先；类型、文档和监控不能替代真实请求与数据验证。
- 低成本、可回滚；优先复用 Workers、KV、GitHub Actions 和现有依赖。
- 可验证交付；每项改动有验收标准、验证命令和未验证项。
- 安全边界不可回归：管理 API 鉴权、Preview/Production 数据与凭据隔离。

## Worker 模块边界

- src/index.ts：请求入口、路由分发、Cron/Webhook 生命周期。
- src/routes：HTTP 路由、输入解析和响应映射。
- src/middleware：认证等横切逻辑。
- src/services：业务用例、GitHub API、扫描、预测和内容解析。
- src/storage：KV 持久化访问。
- src/utils：无业务状态的通用工具。

路由层不承载大段业务流程；Service 不依赖 Hono Context 作为通用容器；Storage 明确 KV 非事务和并发语义。Worker 运行于 workerd，不得默认存在 Node 专属 API。GitHub API 调用必须有频率边界、错误分类和数据校验。

## Admin 模块边界

按复杂度逐步形成边界，不要求一次性创建空目录：

```text
apps/admin/src/
├── app/          # 应用装配
├── api/          # API client 与端点
├── layouts/      # 应用壳层
├── pages/        # 路由级页面
├── features/     # 复杂业务域，按需创建
├── components/   # 跨页面复用 UI
├── composables/  # 可复用响应式逻辑
├── styles/       # Design Tokens
├── types/        # 前端契约
└── utils/        # 无状态工具
```

页面负责组合和页面级状态；可独立测试、跨页面复用或明显复杂的逻辑再抽离。不要为简单组件创建多层抽象。API、认证会话和错误处理统一走共享模块。Design Tokens 是视觉变量唯一来源。响应式、键盘操作、焦点、空/加载/错误状态属于功能验收。

## 类型与运行时校验

- TypeScript 类型只在编译期提供约束，不能证明外部 HTTP/JSON 数据可信。
- 用户、GitHub、Webhook、KV 历史数据按风险在边界做运行时校验。
- 共享契约优先小而明确的纯 TypeScript 模块；只有需要运行时解析时才引入 Schema 库。
- 若引入 Zod，评估 Worker/Admin 是否共享 Schema、版本兼容和 bundle 成本。
- 避免 any；为 GitHub API 建立最小 DTO，处理缺失字段、null、分页和不完整结果。
- KV 结构变更考虑旧记录兼容、回滚和迁移。

## 状态与并发

- 当前不引入 Pinia；页面级状态优先使用 Vue Composition API，跨页面共享优先使用现有明确模块。只有出现真实的跨页面状态协调需求、且原生模块难以维护时，才重新评估状态管理库。
- KV 不提供跨键事务或强一致锁；读-改-写索引可能并发覆盖。
- Cron、Webhook、批量刷新并发时，先说明一致性目标，再决定是否需要 Durable Object、队列或幂等机制。
- 批量 UI 操作需有并发上限、进度、部分失败和停止语义。

## 工具链

- Bun 版本以 packageManager 和 CI 为准，安装使用 frozen lockfile。
- 新依赖需说明收益、原生替代、包体积、Worker 兼容性和维护状态。
- 不在 CI 临时下载未锁定格式化工具；本地与 CI 版本一致。
- 格式化与基础 Lint 统一使用锁定版本的 Biome，不并行维护 Prettier/ESLint。
- 当前锁定的 Biome 2.6.8 启用实验性 HTML super-language 支持，对 Vue SFC 提供 Lint；Vue SFC 格式化暂时关闭，避免实验性格式化器造成大范围模板格式变动。该能力仍可能存在边缘语法/规则缺口，不等同于完整 Vue 专属规则集。
- vue-tsc 独立负责 Vue SFC 模板/脚本类型检查；Vitest 覆盖关键行为。只有发现可复现且影响质量的缺口、现有工具无法合理解决时，才评估新增工具。
- 被 ignore 的业务页面不能长期失去质量检查；例外需有退出条件。

## 测试策略

1. 单元：解析器、预测、路径校验、批处理状态机。
2. 集成：Hono 路由、认证、KV、GitHub API 适配；评估 Workers Vitest Integration。
3. 组件/页面：用户可见行为、错误状态、无障碍语义，不只测内部实现或快照。
4. E2E/真实浏览器：登录、会话失效、项目 CRUD、批量操作、Explorer、移动端流程。

Bug 修复优先建立失败复现测试；重构证明行为不变；UI 自动化不能替代桌面/移动浏览器验收。未运行检查必须写明未执行。

## 安全与发布

- Secret 不进入源码、日志、测试快照、提交或 PR 评论。
- Preview URL 默认可能公开；Preview KV 与 Production KV 隔离；Preview Secret 必须与生产不同。
- PR 控制的代码可读取其 Preview Secret，Preview Secret 不是可信隔离边界。
- 普通测试不扫描或写入生产数据。
- Cloudflare Workers Builds 负责部署；GitHub Actions CI 不重复部署。
- CI 成功不等于部署成功；Smoke Test 需要明确环境和部署完成信号。

## 重构与性能

- Refactor：外部行为不变，改善职责、可读性或边界。
- Performance：先采集基线，再用同一负载比较。
- Cleanup：只移除已证实无用的代码、依赖或配置。
- 每个 PR 聚焦一类目标；不把格式化、升级、架构重构和新功能混在一起。
- 性能结论必须给指标、环境、方法和对比数据；否则标为假设。

## R2 存储约束

- 所有写入 Cloudflare R2 的文件统一采用分块存储，不按文件类型或大小设置例外；这是已接受的架构范围决策，具体实现以 [ADR 0001](../adr/0001-r2-chunked-storage.md) 为准。
- R2 统一分块存储尚未实现。实现前必须完成 ADR 规定的 PoC、成本评估、并发引用追踪、完整性校验和旧对象迁移设计；不得把目标架构描述成当前生产行为。
- 分块算法、块大小、压缩算法、Manifest/D1 Schema、GC 与保留策略不得脱离 ADR 和用户确认单独定案。

## ADR

当选择影响多个模块、长期成本、安全边界、数据结构或部署拓扑时，新增 ADR。记录背景、决策、备选方案、代价、安全/性能/运维影响、回滚策略。小型实现选择写在 PR 描述即可。
