# GKD Subscription Hub

Cloudflare Workers 驱动的 GKD 订阅分发服务：通过 Provider Adapter 扫描 GitHub、GitLab.com、Gitea.com 公开仓库的 `dist/`，按订阅 ID 分配统一路径，提供管理 API、目录页、原始文件分发和浏览器预览。

## 功能

- 从 `src/subscription.ts` 提取 `defineGkdSubscription({ id })`。
- 自动索引 `dist/` 的递归文件树；根路径显示目录。
- GKD、curl、脚本等非 HTML 请求获得原始文件，不包装内容。
- 浏览器访问 Markdown 时使用 markdown-it + highlight.js 渲染；访问 JSON5 时提供只读树形预览和原始文件入口。
- `?raw=1` 强制原始内容。
- GitHub 项目读取 Actions workflow 与运行记录；GitLab 项目读取 Pipelines；Gitea 项目读取 Actions runs。三者归一为统一运行记录，再按成功运行间隔中位数预测下一次检查时间。
- Worker Cron 每 6 小时运行；根据预测时间决定是否刷新项目索引。
- Vue 管理端支持登录、新增、刷新、删除项目；项目可指定分组，管理界面按组展示，桌面端使用数据表格，手机端切换为卡片列表。
- GKD Rules Explorer 采用两阶段扫描：先收集 GitHub 搜索候选并按仓库 ID 去重，再分批验证 Commit、Tree 和 JSON5 订阅文件；扫描期间保留上次已发布目录。支持 Fork 来源、订阅元信息、自定义字段、模糊搜索、订阅 ID 精确筛选、跨仓库重复 ID 提示和排序。
- 管理端提供订阅地址快捷入口、最近检查时间、预测检查时间和错误状态展示。
- 项目元数据保存在独立 KV；订阅文件通过 Provider 的固定版本地址按需读取（GitHub commit SHA、GitLab blob SHA、Gitea commit SHA）。

## 管理端功能

当前管理端提供以下能力：

- 管理员密码登录与退出；登录页独立于业务页面，认证信息保存在当前浏览器会话的 `sessionStorage`。
- 订阅管理、仪表盘和 Explorer 共用 AdminLayout；桌面端采用左侧图标导航，悬停显示菜单名称，移动端使用抽屉导航；未登录访问受保护路由会跳转登录页，API 返回 401 时统一清除失效凭据。
- 仪表盘展示项目数、索引文件数、检查异常、尚未检查数量、最近检查记录和异常项目。
- 运行监控页聚合 GitHub 项目最近一次刷新时保存的 Actions 运行记录，展示状态、触发方式、更新时间和项目索引错误；GitLab/Gitea 暂无 CI 运行记录；页面读取 KV 快照，不会自动轮询上游。
- 文件管理页按订阅项目浏览 `dist/` 文件索引、文件大小和 Git Blob SHA；支持打开 JSON5/Markdown 浏览器预览或原始文件，不提供在线编辑。
- 项目按分组展示并可折叠；支持批量选择、批量刷新和批量删除，删除仅移除本系统项目元数据。
- 按订阅 ID、仓库名、分支和分组搜索，并按检查状态筛选。
- 新增订阅源支持 GitHub、GitLab.com、Gitea.com 公开仓库；可读取对应平台分支列表并通过下拉框选择，默认分支置顶。
- 手动刷新单个订阅源，并查看最近检查错误。
- 打开项目目录中的 `gkd.json5` 订阅文件，或删除项目元数据。

状态标签是根据当前项目记录中的最近检查时间和错误字段推导的，不代表 Worker 正在执行任务，也不代表上游仓库实时可用。自动检查仍由 Worker Cron 负责。

## 管理端响应式设计

管理端使用 Vue 3 + Naive UI，采用 Desktop-first、Mobile-adaptive：

- 桌面端（> 760px）：左侧 72px 图标导航轨道、统计卡片、完整项目表格。
- 平板/窄桌面（≤ 960px）：保持左侧图标导航，内容区自适应。
- 手机端（≤ 760px）：抽屉导航、统计卡片重排、项目卡片列表。

Fluent-inspired 设计参数集中在 `apps/admin/src/styles/tokens.css`。Naive UI 主题和业务样式从同一组 CSS Variables 读取圆角、颜色和间距，避免各页面独立维护第二套设计参数。

## URL 行为

所有服务共用一个主机名，通过路径分流，不再使用项目数字子域名：

- 管理端：`https://gkd.example.com/admin/`
- 文件管理：`https://gkd.example.com/admin/files`
- 运行监控：`https://gkd.example.com/admin/monitoring`
- 管理 API：`https://gkd.example.com/admin/api/*`
- 项目目录：`https://gkd.example.com/<id>/`
- 订阅文件：`https://gkd.example.com/<id>/<dist-path>`，例如 `https://gkd.example.com/233/gkd.json5`
- 通知入口：`POST https://gkd.example.com/hooks/notify`
- 根路径 `/` 重定向到 `/admin/`；未知路径返回 404。

### 仅使用 workers.dev 时

- 管理端：`https://<worker-name>.<account-subdomain>.workers.dev/admin/`
- 项目目录：`https://<worker-name>.<account-subdomain>.workers.dev/<id>/`
- GKD 订阅：`https://<worker-name>.<account-subdomain>.workers.dev/<id>/gkd.json5`

其中 `<worker-name>.<account-subdomain>.workers.dev` 替换为实际部署后 Cloudflare 分配的 Worker 域名，`<id>` 替换为订阅 ID。

代码仓库来源目前仅支持 `github.com`、`gitlab.com` 和 `gitea.com` 的公开 HTTPS URL；GitLab 支持嵌套 Group 路径。自托管 GitLab/Gitea、私有仓库和自定义 Provider 主机暂不支持。

### 临时旧地址

`/gkd.json5` 仅作为当前维护者自己旧订阅的短期兼容入口，代理到其个人订阅仓库；它不属于任何登记项目 ID。兼容窗口结束后会通过独立 PR 删除，不作为长期 API。

优先使用 Fetch Metadata（`Sec-Fetch-Mode`、`Sec-Fetch-Dest`）识别浏览器页面导航与 fetch 请求，`Accept` 作为回退。该识别仅用于内容协商，请求头可以伪造，不能证明客户端身份。可用 `?raw=1` 强制原文，`?view=1` 强制浏览器预览。

## 技术栈

- **运行与包管理**：Bun（依赖管理、脚本、工作区）；Cloudflare Worker 仍运行在 workerd，不运行在 Bun runtime。
- **前端**：Vue 3、Vite、Naive UI、Vue Router。当前业务状态由页面级 Composition API 与共享模块管理，不引入未实际使用的 Pinia。
- **后端**：Cloudflare Workers、Hono、KV。
- **质量工具**：Biome（格式化与 Lint，含实验性 Vue SFC 支持）、vue-tsc（Vue SFC 类型检查）、Vitest。
- **内容处理**：markdown-it（安全 Markdown 渲染）+ highlight.js（按需语言子集代码高亮）。

Vue SFC 使用 Biome 2.6.8 的实验性 HTML super-language 进行 Lint，并由 vue-tsc 负责模板/脚本类型检查；CI 已观察到 `noUnusedImports` 对模板中实际使用的组件产生误报，因此仅对 Vue SFC 关闭该规则。由于格式化器仍属实验性且可能造成较大模板格式变动，当前明确关闭 Vue SFC 格式化。仓库不再使用 Prettier 或 ESLint，以避免重复工具链；若后续发现可复现的质量缺口，再单独评估补充工具。

## 项目结构

```
apps/
  admin/
    src/
      layouts/           # 管理端共享布局
      pages/             # Vue 页面
      styles/            # Design Tokens 与全局样式
    index.html
    vite.config.ts
src/
  index.ts
  types.ts
  routes/
  services/
  storage/
  middleware/
  utils/
test/
.github/workflows/ci.yml
package.json
biome.json
wrangler.jsonc
```

## 部署

### 环境要求

- Bun 1.4.5（与 packageManager 和 CI 锁定版本一致）
- Cloudflare 账号（初次部署使用 workers.dev，不要求自定义域名）
- GitHub、GitLab.com、Gitea.com 公开仓库

### 1. 安装依赖

在仓库根目录执行：

```bash
bun install --frozen-lockfile
```

仓库已提交 `bun.lock`，使用 `bun install --frozen-lockfile` 保证依赖解析可复现。

### 2. Cloudflare 资源

为 Worker 创建独立 KV namespace，并将 namespace ID 配置到 `wrangler.jsonc`。部署者应使用自己 Cloudflare 账户中的 namespace ID。初次部署可使用 `workers.dev`，自定义域名为可选配置。

### 3. 配置 Worker Secrets

生产环境的 `ADMIN_PASSWORD`、可选的 `GITHUB_TOKEN` 和 `NOTIFY_TOKEN` 继续保存在 Cloudflare Worker 的 Production Variables and Secrets 中。GitHub Actions 现在只运行 CI，不再需要 Cloudflare API Token 或生产管理员密码。

Worker Preview 不继承生产 Secrets。首次启用 Preview 前，在 Cloudflare Dashboard 的 Worker → Settings → Variables and Secrets → **Previews Base** 中单独设置一个不同于生产环境的 `ADMIN_PASSWORD`。不要把生产密码复制到 Preview。

### 4. 本地开发

分别启动 Worker 和 Vue 开发服务器：

终端一：

```bash
bun run dev:worker
```

终端二：

```bash
bun run dev:admin
```

Vite 默认运行在 `http://localhost:5173`，将 `/api` 代理到本地 Wrangler Worker（`http://127.0.0.1:8787`）。本地 Worker 使用独立的本地 KV 数据，不要误连生产数据。

### 5. 检查与部署

GitHub Actions 对所有分支和 Pull Request 执行格式检查、Lint、类型检查、测试和构建。生产部署与分支 Preview 由 Cloudflare Workers Builds 原生 Git 集成负责：`main` 部署生产 Worker，其他分支生成 Preview，并自动在 PR 评论预览地址。连接步骤、Build command 和 Preview 数据隔离见 [CI/CD 文档](./docs/CI-CD.md)。

```bash
bun run lint
bun run typecheck
bun run test
bun run build:admin
bun run deploy
```

手动部署命令会先构建 Vue 静态资源，再生成 Worker 类型并调用 Wrangler 部署；生产 Secret 从 Cloudflare Worker 运行时配置读取，不应写入仓库或 GitHub Actions CI。Cloudflare Worker Static Assets 负责托管前端，Worker 继续处理 API 和订阅分发。

### CI/CD 与预览环境

CI/CD 自动化、Cloudflare Preview、数据隔离和手动发布方式见 [CI/CD 文档](./docs/CI-CD.md)。

## 6. 注册订阅

访问管理站 `https://<worker-name>.<account-subdomain>.workers.dev/admin/`，输入管理员密码，添加公开仓库 URL，例如：

- GitHub：`https://github.com/<owner>/<repository>`
- GitLab：`https://gitlab.com/<group>/<subgroup>/<project>`
- Gitea：`https://gitea.com/<owner>/<repository>`

服务将识别 Provider，提取订阅 ID、读取分支和固定 Commit，检查 `dist/` 文件树。相同订阅 ID 不允许重复注册。GKD App 应使用对应项目的 `gkd.json5` 文件链接：`https://gkd.example.com/<id>/gkd.json5`。不要使用目录页 URL。

## 管理 API

所有 API 需请求头 `Authorization: Bearer <ADMIN_PASSWORD>`。

- `GET /admin/api/projects`：项目列表。
- `GET /admin/api/repositories/branches?url=<repo-url>`：读取受支持 Provider 的默认分支与分支列表。
- `POST /admin/api/projects`：注册项目，JSON：`{"url":"https://gitlab.com/group/project"}`。
- `POST /admin/api/projects/:id/refresh`：立即刷新。
- `DELETE /admin/api/projects/:id`：删除项目元数据。

### Explorer API

- `GET /admin/api/explorer/catalog`：已验证的 GKD 订阅仓库目录。
- `GET /admin/api/explorer/status`：发现任务状态。
- `GET /admin/api/explorer/quota`：Worker GitHub Token 的 Core、Search、Code Search 配额。
- `POST /admin/api/explorer/discover`：开始或重置发现任务。
- `POST /admin/api/explorer/discover/step`：推进一批发现与验证任务。

## GKD Rules Explorer

管理端访问 `/admin/explorer`。Explorer 与订阅分发项目列表隔离，使用 KV 的 `explorer:` 前缀保存发现任务和目录快照，不会把发现结果自动注册为订阅分发项目。

发现过程使用公开仓库搜索、代码搜索作为候选入口，再读取默认分支的 Git Tree 并验证 `dist/` 下的 JSON5/JSON 订阅文件。只有通过订阅 ID、名称、版本和规则集合校验的仓库才进入目录。Fork 会保留，并展示直接 parent 仓库；不追溯更长的 Fork 链。订阅文件的未知顶层字段保存在自定义字段中。

扫描采用手动推进、可恢复的批次任务。GitHub 搜索结果存在索引、分页和每查询最多 1,000 条等限制，代码搜索也存在独立配额，因此目录不保证覆盖所有公开仓库。遇到 GitHub 限流时任务会暂停；等待配额恢复后可继续。筛选、搜索和排序在浏览器本地执行，不会为每次筛选重新请求 GitHub。

详细设计见 [GKD Rules Explorer 技术方案](./docs/gkd-rules-explorer-design.md)。

## 更新预测的边界

目前仅 GitHub Actions 的 cron 字段会被解析和展示；GitLab CI 与 Gitea Actions 的运行状态已映射到统一运行模型，但尚未解析各平台工作流文件中的调度表达式。预测间隔主要依据最近成功的运行完成时间中位数，不是完整 cron 语法解释器。排队延迟、手动触发、取消运行和 GitHub 服务延迟都会影响预测。预测时间不等于上游内容发布时间保证。

## 安全与数据

KV 保存项目索引和元数据；订阅文件按 Provider 固定版本读取，当前支持 GitHub、GitLab.com、Gitea.com 公开仓库。管理密码、GitHub Token 和 `NOTIFY_TOKEN` 使用 Worker Secrets。Worker 不修改上游仓库。Webhook 只是加速触发机制，Cron 每 6 小时轮询仍是主机制；当前通知入口仍仅识别已登记的 GitHub 仓库，并在 Worker 端重新扫描上游，不信任通知负载中的版本信息。GitLab/Gitea Webhook 接入尚未实现。配置 `NOTIFY_TOKEN` 后，调用方需使用 `Authorization: Bearer <NOTIFY_TOKEN>`，JSON 请求体格式为 `{"provider":"github","repository":"owner/repo"}`。KV 冷却键仅为尽力而为的去重，不作为强一致限流或安全边界。

## 工程与贡献

- [贡献指南](./CONTRIBUTING.md)
- [工程手册](./docs/engineering/README.md)
- [工程标准](./docs/engineering/engineering-standards.md)
- [架构审计](./docs/engineering/architecture-audit.md)
- [AI Agent 与提示词工程](./docs/engineering/agent-workflows.md)

## License

本项目采用 GNU General Public License v3.0 or later（GPL-3.0-or-later），见 [LICENSE](./LICENSE)。
