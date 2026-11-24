# 架构概览

本文描述当前实现和数据边界；部署环境配置仍需在目标 Cloudflare 账户核实。本文描述实际请求流和数据边界，不代表所有外部环境配置均已验证。

## 系统组成

- **Cloudflare Worker**：统一 HTTP 入口，承载管理 API、订阅分发、Webhook 和 Cron。
- **SPA**：Vue 3 + Vite + Naive UI + Lucide；根路径 `/` 提供公共只读门户，`/admin/` 提供受保护管理页面，均由 Worker Static Assets 托管。
- **KV**：保存订阅项目索引、项目元数据、Explorer 扫描状态/目录快照、版本索引和 Webhook 冷却键。
- **代码托管 Provider**：当前通过 `src/services/providers.ts` 支持 GitHub、GitLab.com、Gitea.com 的公开仓库 Adapter；自托管实例尚未开放。
- **版本与文件读取**：统一抽象仓库、默认分支、Commit、Tree、分支列表和文件内容；固定版本文件分发由 Adapter 生成 URL。Release/Tag 和通知事件的统一抽象仍待后续阶段。
- **CI 状态**：GitHub Actions、GitLab Pipelines、Gitea Actions 运行记录统一映射到 `WorkflowRun`；工作流配置发现和 cron 解析仍仅支持 GitHub。

## 请求入口分流

Worker 入口位于 src/index.ts：

- GET /：提供公共只读门户 SPA。
- GET /gkd.json5：兼容旧订阅入口，代理旧订阅内容。
- /admin：重定向到 /admin/。
- /admin/api/*：去掉 /admin 前缀后交给 Hono Admin Router；API 路由通过 auth middleware。
- 其他 /admin/*：交给 Worker Static Assets，Vue Router 处理受保护管理页面。
- POST /hooks/notify：验证 NOTIFY_TOKEN、校验仓库格式、确认仓库已登记、检查 KV 冷却键，再用 waitUntil 异步刷新。
- `/api/public/*`：只读公共 API，仅注册 GET 路由。
- `/{numeric-id}/*`：订阅分发 Router；`/<id>/dist/` 展示目录，`/<id>/dist/<file>` 访问文件。
- 其他路径：404。
- Cron：每 6 小时触发一次，按项目预测时间检查是否需要刷新。

## 公共门户数据流

1. 浏览器在 `/` 加载公共只读 SPA。
2. 页面只调用 `/api/public/subscriptions` 与 `/api/public/explorer` 两个 GET 接口。
3. Worker 返回 allowlist DTO，不暴露 Git Blob SHA、项目错误、扫描任务、配额或写入能力。
4. 公共目录不读取管理 Token，也不调用 Admin API。

## 管理端数据流

1. 浏览器加载 /admin/ 下的 SPA。
2. Vue Router 对受保护路由检查当前 sessionStorage 中的管理 Token。
3. 页面通过统一 API client 请求 /admin/api/*，携带 Bearer Token。
4. Worker Hono auth middleware 验证管理凭据，再执行项目或 Explorer API。
5. API 返回 401 时，前端统一清理会话并跳转登录；网络错误和其他状态不应被误判为会话过期。

主要模块：

- apps/admin/src/main.ts：Vue 应用入口与插件装配。
- apps/admin/src/router.ts：路由和登录保护。
- apps/admin/src/auth.ts：会话存取。
- apps/admin/src/api.ts：统一 API client。
- apps/admin/src/layouts/AdminLayout.vue：受保护页面共享壳层。
- apps/admin/src/pages：仪表盘、项目管理、Explorer、登录页面。

## 项目扫描与订阅分发

### 注册/刷新

1. Admin 调用项目注册或刷新 API。
2. `parseRepositoryUrl()` 识别 GitHub、GitLab.com、Gitea.com；`scanner.ts` 通过 Provider Adapter 读取仓库元数据、默认/指定分支、Commit、Tree 和订阅源文件。
3. 从 src/subscription.ts 提取订阅 ID；扫描 dist/ 文件列表，拒绝被截断的 Git Tree 和无效路径。
4. 对 dist 文件路径、SHA 和大小排序后计算摘要。
5. GitHub Adapter 读取 Actions workflow 并提取 cron；GitLab Adapter 读取 Pipelines，Gitea Adapter 读取 Actions runs。GitLab/Gitea 的 workflow 文件和 cron 表达式尚未解析。
6. src/services/actions.ts 读取最近 workflow runs，根据成功运行时间间隔中位数预测下一次检查时间。
7. src/storage/projects.ts 保存项目元数据。

### 分发

1. 请求 /{id}/...，从 KV 读取 project:{id}。
2. `/<id>/` 和 `/<id>/dist/` 展示当前已索引的 dist 文件目录；文件链接使用 `/dist/` 前缀。
3. 文件路径必须通过路径校验，并且存在于项目 distFiles 索引中。
4. 新登记项目的上游文件 URL 由 Provider Adapter 生成：GitHub 按 commit SHA、GitLab 按 blob SHA、Gitea Media API 按 commit SHA；不在分发路由硬编码 GitHub Raw。
5. 非浏览器请求获取原始内容；浏览器可将 Markdown 渲染为 HTML，或预览 JSON5。
6. 目录页和预览页不代表上游仓库实时状态；固定 SHA 路径依赖对应 Provider 的文件读取能力，历史分支回退路径可能随分支更新而变化。

## Explorer 数据流

- 路由：src/routes/explorer.ts。
- 业务逻辑：src/services/explorer.ts。
- 独立使用 explorer: 前缀保存扫描 Job 和已验证目录快照。
- Explorer 候选发现目前仍通过 GitHub Search；其余 Provider 的仓库注册/扫描/分发已走 Adapter，未来如需多源 Explorer，再为 GitLab/Gitea 实现各自搜索与分页能力。
- 扫描是可恢复的批次任务；每次 step 处理有限候选，遇到配额限制可暂停。
- Explorer 结果不会自动注册为正式订阅分发项目。

## KV 键空间

- **projects:index**：已登记项目 ID 列表。
- **project:{id}**：单个项目元数据与 dist 文件索引。
- **explorer:***：Explorer 扫描任务和目录快照。
- **notify:cooldown:{id}**：Webhook 尽力而为的短时去重键。

KV 不提供跨键事务或强一致锁。projects:index 与 project:{id} 分开写入，保存/删除不是原子操作；Webhook 冷却键也不是强一致限流边界。

## 关键运行约束

- Worker 运行于 workerd；请求状态应通过函数参数传递，不放入跨请求可变全局变量。
- 各 Provider 有独立认证、速率限制、分页和搜索能力；GitHub Token 只影响 GitHub API 配额，不可套用到其他平台。
- 搜索和 Tree 结果可能不完整；Explorer 目录不保证覆盖全部公开仓库。
- Cron 与 Webhook 可能同时刷新同一项目；当前 KV 结构没有跨请求互斥锁，需要在并发测试中验证是否出现旧数据覆盖。
- Preview URL 可能公开；Preview KV 与生产 KV 应隔离，Preview Secret 不得复用生产值。

## 后续架构演进

- 继续实现 Release/Tag 与统一通知事件；评估是否开放自托管实例和多 Provider Explorer。
- 各 Provider 的 API DTO 和运行时校验保持在 Adapter 边界内；自托管实例需另行设计 host allowlist、认证和 SSRF 防护。
- 评估项目索引的 KV 并发一致性需求；不要未评估就引入 Durable Objects。
- 共享 API DTO 仅在真实重复和兼容成本证明有收益时提取。
- 管理端页面按复杂度逐步拆分，不按目录模板机械搬迁。
- 重大跨模块决策写入 docs/adr/。

## 订阅版本历史与归档

- `gkd.version.json5` 是当前订阅版本元数据；版本号相同不会创建重复快照。
- 扫描和刷新通过固定 Commit SHA 记录版本；刷新时先补录旧 Commit 的版本，再记录新版本。
- 历史 URL 使用 `/<id>/v<version>/gkd.json5`；不通过当前分支或最新版回退伪造旧内容。
- KV 仅保存小型版本索引；Git 固定 Commit SHA 与文件 Blob SHA 是唯一历史来源，读取时校验 SHA-256。
- Worker 不绑定 R2、不写入 R2，也不提供任何 R2 归档 API，避免订阅服务因对象存储用量超额而产生额外费用。
- 上游 Git 历史被删除或改写后，历史版本可能不可恢复；必须明确显示不可用，绝不以最新版冒充历史快照。


## GKD JSON5 预览器

- 浏览器对订阅 JSON5 的 HTML 导航使用 `/preview/<id>?file=<dist-path>`；历史版本使用 `/preview/<id>?version=<version>`。GKD 客户端访问 `/<id>/gkd.json5` 与历史 URL 时仍获得原始 JSON5 字节，不改变订阅 URL 兼容性。
- Preview SPA 在同源读取 JSON5，默认结构化预览上限 10 MB；10–50 MB 需要用户主动选择继续，超过 50 MB 提供原始文件入口。
- 主线程将 ArrayBuffer 转移给独立 Web Worker；Worker 内使用 JSON5 和官方 `@gkd-kit/api` 的订阅结构完成解析及数据摘要。应用、规则组、规则分页每页 50 项，规则详情按需请求。
- 原始 JSON5 文本只在用户打开原始 Tab 后重新请求；页面切换/卸载时取消网络请求并终止 Worker。
- 此预览器只用于交互展示，不改写上游 JSON5，不将 HTML 预览内容作为 GKD 订阅响应。
