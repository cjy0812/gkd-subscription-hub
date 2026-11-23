# 架构与工程审计

> 基线：2026-11-23，main（审计时 HEAD：`139fb36ded81994a651a0cb1ba96b65053a2d721`）。静态代码审计；本轮未运行本地构建、浏览器或生产验证。

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

### A-03（已解决，PR #26）：Explorer 使用宽泛类型

PR #26 已合并至 main（2026-11-23）。Explorer 搜索候选和关键 GitHub 响应改为 unknown + 运行时类型守卫并补测试。此项从当前基线移除；Scanner/Actions 中仍有其他宽泛 GitHub API 类型，见 A-08。

### A-04（已解决，PR #28）：移除未使用的 Pinia

全仓库搜索 `defineStore` 无结果；`createPinia` 只在 `apps/admin/src/main.ts` 用于初始化，没有 Store 定义或使用。PR #28 已从 Admin 依赖、应用装配和锁文件移除 Pinia；frozen install、格式检查、Lint、类型检查、测试和 Admin build 均通过。

### A-05（中）：Vue SFC 工具覆盖仍需观察

Biome 2.6.8 的实验性 HTML super-language 用于 Vue SFC Lint，但 Vue SFC 格式化明确关闭：CI 证明启用后会对 ProjectsPage.vue 产生较大模板格式重排，且该格式化器仍属实验性。CI 还确认 `correctness/noUnusedImports` 会把模板中实际使用的 Naive UI 组件误报为未使用，因此仅对 Vue SFC 关闭该规则，JS/TS 仍启用。`vue-tsc` 继续负责模板/脚本类型检查。当前接受 Vue SFC 格式化与该规则覆盖缺口，不额外引入 ESLint/Prettier；若后续发现可复现质量缺口，再基于证据评估。

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

### A-12（部分完成，PR #31 已合并）：运行监控 UI

新增 `/admin/monitoring`，从项目 KV 快照聚合最近缓存的 GitHub Actions 运行记录、非成功结束数量、未结束数量和项目索引错误；明确标注读取快照，不会自动请求 GitHub。尚未实现实时轮询或独立任务事件历史。

### A-13（部分完成，PR #32 已合并）：只读文件管理 UI

新增 `/admin/files`，从项目 KV 快照读取 dist 文件路径、大小和 Blob SHA，并链接现有分发路由的 JSON5/Markdown 预览及原始文件。无文件内容写入、无在线编辑；路径不符合当前分发路由允许字符时不生成链接。尚未实现版本差异、编辑器和保存流程。

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
3. 分离 Explorer 数据筛选/排序与 API 状态。
4. 依据真实复用情况抽组件。

### P3：体验验收

1. 浏览器 E2E/人工验收。
2. 桌面/移动端与可访问性检查。
3. 按路线图推进监控、文件和历史页面。

修复后必须关联 PR/commit；未运行测试不得从待验证改成通过。


## 管理端体验反馈审计（2026-11-23）

以下条目来自维护者对已部署管理端的 11 项反馈。本节把源码确认与线上待复现分开；不将未证实的根因记录为事实。

### A-14（低）：登录占位文案泄露部署变量名

`apps/admin/src/pages/LoginPage.vue` 的标签已是“管理员密码”，但输入框 placeholder 为“输入 ADMIN_PASSWORD”。改为面向用户的“请输入管理员密码”。这是文案修正，不涉及 Secret 名称或认证逻辑。

### A-15（待复现）：桌面侧栏线上显示在右侧

`AdminLayout.vue` 的 `NLayoutSider` 在 `NLayoutContent` 之前，结构上应为左侧侧栏；移动端 Drawer 也声明 `placement="left"`。维护者反馈线上菜单显示在右侧。当前不能仅凭源码确定原因。验收需记录部署 Commit、浏览器、视口宽度、页面截图，并检查 CSS direction、Naive UI 布局计算、缓存/Preview 与 Production 是否版本一致。

### A-16（中）：项目注册表单缺少分支发现

新增项目表单使用自由文本分支；Worker 注册 API 也只接收 `branch` 字符串。建议增加受控的分支列表 API/选择器，并在仓库 URL 验证后加载默认分支和分支列表；需处理网络失败、无权限/仓库不存在和分支删除竞态。

### A-17（高，已确定方向、尚未实现）：Provider Adapter 支持 GitHub / GitLab / Gitea

此前产品讨论已明确：首批 Provider 为 GitHub、GitLab、Gitea；架构需允许未来增加其他平台。当前 `src/services/scanner.ts` 的 `parseRepo()` 仅接受 `github.com`，注册、扫描、Actions 运行记录和 Raw 文件分发均直接依赖 GitHub API/Raw，因此现状与已确定方向存在差距。

统一接口至少覆盖：
- 仓库 URL 解析、实例地址、命名空间/项目路径与默认分支；
- 分支列表、Ref、Commit SHA、递归 Tree、文件内容读取；
- Release / Tag / Commit 版本状态与更新事件；
- CI 工作流/流水线状态（GitHub Actions、GitLab CI、Gitea Actions 等能力需按 Provider 映射；不可假设完全等价）；
- API 认证、限流、分页、错误分类和 webhook 签名验证。

更新策略已确定：本端 Cron/主动拉取为主；平台 Webhook 为可选加速。统一 `/hooks/notify`，不为每个项目创建独立 Webhook；收到通知后必须由本端重新拉取并验证，不信任通知载荷中的版本或文件内容。新系统接管后旧 Worker 退役，保留回滚脚本。

订阅 URL 统一为 `https://gkd.chenge.eu.org/<id>/<dist>`；此前已决定不保留旧子域名和 `/s/<id>/` 兼容路径。

这不是待确认产品范围；待设计/实现的是 Provider adapter、Project schema 迁移、认证配置和各平台能力差异。

### A-18（中）：项目列表信息层级与源码入口

当前表格在“订阅源”单元格把 ID 放在仓库名上方；项目操作只有“打开订阅、刷新、删除”，没有直达上游源码仓库的独立入口。重新设计为仓库名优先、ID 作为次级元信息，并加入上游仓库链接。图标按钮须提供 Tooltip/aria-label；删除仍需确认。

### A-19（中）：Markdown 预览体验

`src/routes/subscription.ts` 使用 markdown-it，禁用原始 HTML；当前没有专门的 Markdown 阅读主题/样式系统。需检查 `documentPage()` 的基础 CSS 和常见 Markdown 元素表现，补安全链接策略与窄屏验收。

### A-20（中）：JSON5 预览不可读

当前 JSON5 浏览器预览把原始内容直接放入 `pre/code`，无 JSON5 解析、格式化、树形展开或语法高亮。仓库已有 `src/services/json5.ts` 的受限解析器，但它位于 Worker 服务端，不能直接假设可用于前端。需评估共享解析依赖/前端专用解析器与轻量高亮组件，支持源码/结构化双视图、解析失败回退、超大文件保护和原始文件入口。

### A-21（中）：订阅管理缺少源码入口

与 A-18 同一根因：列表可打开分发订阅，但没有清晰区分并链接上游仓库源码。新增仓库链接应基于已保存的 `repoUrl` 或 Provider URL，不应从 owner/repo 字符串拼接未验证地址。

### A-22（中）：Explorer 搜索与候选收集耦合

当前 `stepExplorer()` 每次调用最多读取一个 Search API 页面，接着验证该页候选；`VERIFY_PER_STEP=4` 限制单步验证量。Repository Search 最多遍历 10 页（每页 100），Code Search 每个查询只读第一页。维护者希望先收集候选再逐层筛选。建议评估两阶段有界流程（候选收集阶段 + 候选验证阶段），但不能承诺无界全量抓取：GitHub 搜索结果上限/索引不完整、Workers 执行预算、KV 单值限制和 GitHub 配额仍然存在。应保留可恢复游标、候选去重和不完整标记。

### A-23（待复现）：Explorer 结果中出现大量订阅 ID 233

`filterExplorerEntries()` 对仓库名、描述、Owner、Topic、订阅名称、作者、订阅 ID、版本和自定义字段执行合并后的子串匹配；没有独立的精确 ID 筛选。后端按 GitHub repository ID 去重，但未对不同仓库的相同 subscription ID 作显式冲突诊断。当前源码不能证明 ID 233 重复是数据真实如此、搜索词误匹配、缓存问题还是分页问题。需要取得具体搜索词、目录快照和相关仓库，核对原始 JSON5、repository.id、subscription.id、搜索命中字段及 row-key；补充精确 ID 筛选与重复 ID 冲突报告。

### 验收证据要求

- 线上布局类问题：部署 SHA + 浏览器/设备 + 视口 + 截图/复现步骤。
- 搜索/数据类问题：原始搜索词 + 返回仓库 full_name/repository.id + subscription.id + 对应订阅文件 SHA。
- 渲染类问题：原始文件样本（可脱敏）+ Content-Type/Accept 行为 + 浏览器截图。
- 未取得上述证据前，相关根因保持“待复现/未证实”。
