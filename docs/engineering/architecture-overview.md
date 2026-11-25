# 架构概览

本文描述当前实现和数据边界；部署环境配置仍需在目标 Cloudflare 账户核实。本文描述实际请求流和数据边界，不代表所有外部环境配置均已验证。

## 系统组成

- **Cloudflare Worker**：统一 HTTP 入口，承载管理 API、订阅分发、Webhook 和 Cron。
- **SPA**：Vue 3 + Vite + Naive UI + Lucide；根路径 `/` 提供公共只读门户，`/admin/` 提供受保护管理页面，均由 Worker Static Assets 托管。
- **KV**：保存订阅项目索引、项目元数据、Explorer 扫描状态/目录快照和 Webhook 冷却键。
- **D1**：保存订阅版本唯一索引、内容对象元数据、归档状态与每日 R2 读写预算；复合主键隔离相同订阅 ID 下不同仓库。
- **R2**：保存 Gzip 压缩后的原始 JSON5 历史对象；以原始内容 SHA-256 寻址，相同字节只保存一份。Bucket 不公开，只有 Worker binding 可访问。
- **Workers Cache**：缓存已校验的历史响应；缓存不是持久化来源，命中缓存不会访问 R2。
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
- `/{numeric-id}/*`：订阅分发 Router；`/<id>/` 展示目录，`/<id>/<file>` 访问文件。
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
2. `/<id>/` 展示当前已索引的 dist 文件目录；文件链接统一使用 `/<id>/<dist-path>`，不维护旧 `/dist/` URL 兼容层。
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
- Cron 与 Webhook 可能同时刷新同一项目；D1 复合唯一键保证版本索引只绑定一个胜出 Commit，但 KV 项目元数据仍没有跨请求互斥锁，需单独验证旧项目数据是否可能覆盖新数据。
- Preview URL 可能公开；Preview KV/D1/R2 与生产资源必须隔离，Preview Secret 不得复用生产值。

## 后续架构演进

- 继续实现 Release/Tag 与统一通知事件；评估是否开放自托管实例和多 Provider Explorer。
- 各 Provider 的 API DTO 和运行时校验保持在 Adapter 边界内；自托管实例需另行设计 host allowlist、认证和 SSRF 防护。
- 评估项目索引的 KV 并发一致性需求；不要未评估就引入 Durable Objects。
- 共享 API DTO 仅在真实重复和兼容成本证明有收益时提取。
- 管理端页面按复杂度逐步拆分，不按目录模板机械搬迁。
- 重大跨模块决策写入 docs/adr/。

## 订阅版本历史（Cloudflare R2 + D1）

- `gkd.version.json5` 是订阅版本元数据；普通 Git commit 不创建新版本。
- 首次登记时，从上游 Provider 固定 Commit 读取 `gkd.json5` 原始字节；历史版本写入后，读取链路不再依赖 GitHub/GitLab/Gitea。
- D1 的唯一键为 subscription ID + repository identity + version，解决 KV 最终一致性导致的同版本并发写入覆盖，也避免删除后用不同仓库重注册时串用旧历史。
- 原始字节先计算 SHA-256，再使用 Gzip 压缩；R2 对象键由 SHA-256 决定，相同内容跨版本/订阅共用对象。
- D1 保存对象原始大小、压缩大小、状态和 R2 key；归档容量由 D1 trigger 原子限制，默认 512 MiB。每日最多预留 200 个新对象、最多执行 200 次 R2 PUT、最多执行 20,000 次 R2 GET；预算耗尽时拒绝新增读写，不通过自动升级计划解决。
- Worker 读取 R2 后解压，检查原始长度和 SHA-256，再返回原始 JSON5 字节；支持 ETag/304 和 Workers Cache。Cache 丢失后从 R2 恢复。
- R2 Bucket 不开放公开访问、不配置生命周期删除规则；D1/R2 均使用独立 Preview 资源，避免 Preview 写入生产归档。
- 旧 KV Git-only 快照在首次访问时尝试迁移；迁移前仍依赖旧 Provider。迁移失败会明确标记不可用，不会回退到最新版冒充历史内容。
- 删除项目只移除项目元数据，不自动删除 D1/R2 历史对象；对象按内容去重共享，暂不做自动垃圾回收，优先保证历史持久性。

## GKD JSON5 预览器

- 浏览器对订阅 JSON5 的 HTML 导航直接使用 `/<id>/<dist-path>`；历史版本使用 `/<id>/v<version>/gkd.json5`。不再提供旧 `/preview/<id>?file=...` 路由。GKD 客户端访问 `/<id>/gkd.json5` 与历史 URL 时仍获得原始 JSON5 字节，不改变订阅 URL 兼容性。
- Preview SPA 在同源读取 JSON5，使用 `ReadableStream` 逐块累计响应体字节，并在超限时取消读取，不依赖 `Content-Length`。默认结构化预览上限 10 MB；10–50 MB 需要用户主动选择继续，超过 50 MB 提供原始文件入口。历史版本在 Worker 端另有 20 MB 流式读取上限和强制 SHA-256 校验。
- 主线程将 ArrayBuffer 转移给独立 Web Worker；Worker 内使用 JSON5 和官方 `@gkd-kit/api` 的订阅结构完成解析及数据摘要。应用、规则组、规则分页每页 50 项，规则详情按需请求。
- 原始 JSON5 文本只在用户打开原始 Tab 后重新请求；页面切换/卸载时取消网络请求并终止 Worker。`?raw=1` 对当前版与历史版均强制返回原始文件字节；浏览器可用 `?view=source` 在同一文件 URL 打开源码视图。
- 此预览器只用于交互展示，不改写上游 JSON5，不将 HTML 预览内容作为 GKD 订阅响应。
