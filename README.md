# GKD Subscription Hub

Cloudflare Workers 驱动的 GKD 订阅分发服务：扫描 GitHub 仓库的 `dist/`，按订阅 ID 分配统一路径，提供管理 API、目录页、原始文件分发和浏览器预览。

## 功能

- 从 `src/subscription.ts` 提取 `defineGkdSubscription({ id })`。
- 自动索引 `dist/` 的递归文件树；根路径显示目录。
- GKD、curl、脚本等非 HTML 请求获得原始文件，不包装内容。
- 浏览器请求访问 Markdown 时使用 markdown-it 渲染；访问 JSON5 时显示代码预览。
- `?raw=1` 强制原始内容。
- 读取 GitHub Actions workflow 和近期运行记录，按成功运行间隔中位数预测下一次检查时间。
- Worker Cron 每 6 小时运行；根据预测时间决定是否刷新项目索引。
- Vue 管理端支持登录、新增、刷新、删除项目；项目可指定分组，管理界面按组展示，桌面端使用数据表格，手机端切换为卡片列表。\n- GKD Rules Explorer 从公开 GitHub 搜索候选仓库，验证完整订阅文件，支持 Fork 来源、订阅元信息、自定义字段、搜索筛选和排序。
- 管理端提供订阅地址快捷入口、最近检查时间、预测检查时间和错误状态展示。
- 项目元数据目前保存在独立 KV，订阅文件按需从 GitHub raw 获取。

## 管理端响应式设计

管理端使用 Vue 3 + Naive UI，采用 Desktop-first、Mobile-adaptive：

| 屏幕                   | 布局                                 |
| ---------------------- | ------------------------------------ |
| 桌面端（> 760px）      | 侧边栏、统计卡片、完整项目表格       |
| 平板/窄桌面（≤ 960px） | 压缩侧边栏与内容间距                 |
| 手机端（≤ 760px）      | 抽屉导航、统计卡片重排、项目卡片列表 |

Fluent-inspired 设计参数集中在 `apps/admin/src/styles/tokens.css`。Naive UI 主题和业务样式从同一组 CSS Variables 读取圆角、颜色和间距，避免各页面独立维护第二套设计参数。

## URL 行为

所有服务共用一个主机名，通过路径分流，不再使用项目数字子域名：

- 管理端：`https://gkd.example.com/admin/`
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

### 临时旧地址

`/gkd.json5` 仅作为当前维护者自己旧订阅的短期兼容入口，代理到其个人订阅仓库；它不属于任何登记项目 ID。兼容窗口结束后会通过独立 PR 删除，不作为长期 API。

优先使用 Fetch Metadata（`Sec-Fetch-Mode`、`Sec-Fetch-Dest`）识别浏览器页面导航与 fetch 请求，`Accept` 作为回退。该识别仅用于内容协商，请求头可以伪造，不能证明客户端身份。可用 `?raw=1` 强制原文，`?view=1` 强制浏览器预览。

## 技术栈

- **运行与包管理**：Bun（依赖管理、脚本、工作区）；Cloudflare Worker 仍运行在 workerd，不运行在 Bun runtime。
- **前端**：Vue 3、Vite、Naive UI、Vue Router、Pinia。
- **后端**：Cloudflare Workers、Hono、KV。
- **质量工具**：Biome（TypeScript/JavaScript/JSON/CSS 等支持范围）、Prettier（Vue SFC 格式化）、vue-tsc（Vue SFC 类型检查）、Vitest。
- **内容处理**：markdown-it。

Biome 不负责 Vue SFC 的格式化和完整语义检查；Vue SFC 由 Prettier 格式化、vue-tsc 类型检查。

## 项目结构

```
apps/
  admin/
    src/
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

- Bun（建议使用稳定版）
- Cloudflare 账号（初次部署使用 workers.dev，不要求自定义域名）
- GitHub 公开仓库

### 1. 安装依赖

在仓库根目录执行：

```bash
bun install
```

仓库已提交 `bun.lock`，使用 `bun install --frozen-lockfile` 保证依赖解析可复现。

### 2. Cloudflare 资源

为 Worker 创建独立 KV namespace，并将 namespace ID 配置到 `wrangler.jsonc`。部署者应使用自己 Cloudflare 账户中的 namespace ID。初次部署可使用 `workers.dev`，自定义域名为可选配置。

### 3. 配置 GitHub Actions Secrets

在仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加：

- `CLOUDFLARE_API_TOKEN`：Cloudflare API Token，使用 **Edit Cloudflare Workers** 模板，并限制到本 Cloudflare 账号。
- `ADMIN_PASSWORD`：你自行设置的管理端登录密码。
- `NOTIFY_TOKEN`（可选）：Webhook 入口的 Bearer Token；配置后才能调用 `POST /hooks/notify`。建议使用高熵随机值。

不要把这两个值发到聊天或提交到 Git。部署工作流通过临时 secrets 文件将 `ADMIN_PASSWORD` 作为 Worker Secret 一并上传，完成后删除临时文件。

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

GitHub Actions 对 Pull Request 和 main 分支推送执行格式检查、Lint、类型检查、测试和构建。main 分支 CI 成功且仓库已配置 `CLOUDFLARE_API_TOKEN` 后，CD 自动部署到独立 Worker `<worker-name>`。也可通过 workflow_dispatch 手动部署。

```bash
bun run lint
bun run typecheck
bun run test
bun run build:admin
bun run deploy
```

部署命令会先构建 Vue 静态资源，再生成 Worker 类型并调用 Wrangler 部署。`ADMIN_PASSWORD` 通过 GitHub Actions Secret 注入，不在仓库保存明文。Cloudflare Worker Static Assets 负责托管前端，Worker 继续处理 API 和订阅分发。

### 6. 注册订阅

访问管理站 `https://<worker-name>.<account-subdomain>.workers.dev/admin/`，输入管理员密码，添加公开仓库 URL，例如：

`https://github.com/<owner>/<repository>`。

服务将提取 ID、检查分支、dist 文件树和 Actions 工作流。相同 ID 不允许重复注册。GKD App 应使用对应项目的 `gkd.json5` 文件链接：`https://gkd.example.com/<id>/gkd.json5`。不要使用目录页 URL。

## 管理 API

所有 API 需请求头 `Authorization: Bearer <ADMIN_PASSWORD>`。

| 方法   | 路径                              | 作用                                                      |
| ------ | --------------------------------- | --------------------------------------------------------- |
| GET    | `/admin/api/projects`             | 项目列表                                                  |
| POST   | `/admin/api/projects`             | 注册项目，JSON：`{"url":"https://github.com/owner/repo"}` |
| POST   | `/admin/api/projects/:id/refresh` | 立即刷新                                                  |
| DELETE | `/admin/api/projects/:id`         | 删除项目元数据                                            |

## GKD Rules Explorer

管理端访问 `/admin/explorer`。Explorer 与订阅分发项目列表隔离，使用 KV 的 `explorer:` 前缀保存发现任务和目录快照，不会把发现结果自动注册为订阅分发项目。

发现过程使用公开仓库搜索、代码搜索作为候选入口，再读取默认分支的 Git Tree 并验证 `dist/` 下的 JSON5/JSON 订阅文件。只有通过订阅 ID、名称、版本和规则集合校验的仓库才进入目录。Fork 会保留，并展示直接 parent 仓库；不追溯更长的 Fork 链。订阅文件的未知顶层字段保存在自定义字段中。

扫描采用手动推进、可恢复的批次任务。GitHub 搜索结果存在索引、分页和每查询最多 1,000 条等限制，代码搜索也存在独立配额，因此目录不保证覆盖所有公开仓库。遇到 GitHub 限流时任务会暂停；等待配额恢复后可继续。筛选、搜索和排序在浏览器本地执行，不会为每次筛选重新请求 GitHub。

详细设计见 [GKD Rules Explorer 技术方案](./docs/gkd-rules-explorer-design.md)。

## 更新预测的边界

目前 cron 字段用于识别和展示工作流调度配置；预测间隔主要依据最近成功的 workflow run 完成时间中位数，不是完整 cron 语法解释器。排队延迟、手动触发、取消运行和 GitHub 服务延迟都会影响预测。预测时间不等于上游内容发布时间保证。

## 安全与数据

KV 保存项目索引和元数据；订阅文件从公开 GitHub raw 按需读取。管理密码、GitHub Token 和 `NOTIFY_TOKEN` 使用 Worker Secrets。Worker 不修改上游仓库。Webhook 只是加速触发机制，Cron 每 6 小时轮询仍是主机制；通知只接受已登记的 GitHub 仓库，并在 Worker 端重新扫描上游，不信任通知负载中的版本信息。配置 `NOTIFY_TOKEN` 后，调用方需使用 `Authorization: Bearer <NOTIFY_TOKEN>`，JSON 请求体格式为 `{"provider":"github","repository":"owner/repo"}`。KV 冷却键仅为尽力而为的去重，不作为强一致限流或安全边界。

## License

本项目采用 GNU General Public License v3.0 or later（GPL-3.0-or-later），见 [LICENSE](./LICENSE)。
