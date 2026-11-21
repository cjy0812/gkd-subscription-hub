# GKD Subscription Hub

Cloudflare Workers 驱动的 GKD 订阅分发服务：扫描 GitHub 仓库的 `dist/`，按订阅 ID 分配子域名，提供管理 API、目录页、原始文件分发和浏览器预览。

## 功能

- 从 `src/subscription.ts` 提取 `defineGkdSubscription({ id })`。
- 自动索引 `dist/` 的递归文件树；根路径显示目录。
- GKD、curl、脚本等非 HTML 请求获得原始文件，不包装内容。
- 浏览器请求访问 Markdown 时使用 markdown-it 渲染；访问 JSON5 时显示代码预览。
- `?raw=1` 强制原始内容。
- 读取 GitHub Actions workflow 和近期运行记录，按成功运行间隔中位数预测下一次检查时间。
- Worker Cron 每 6 小时运行；根据预测时间决定是否刷新项目索引。
- Vue 管理端支持登录、新增、刷新、删除项目，桌面端使用数据表格，手机端切换为卡片列表。
- 项目元数据目前保存在 KV，订阅文件按需从 GitHub raw 获取。

## 管理端响应式设计

管理端使用 Vue 3 + Naive UI，采用 Desktop-first、Mobile-adaptive：

| 屏幕 | 布局 |
|---|---|
| 桌面端（> 760px） | 侧边栏、统计卡片、完整项目表格 |
| 平板/窄桌面（≤ 960px） | 压缩侧边栏与内容间距 |
| 手机端（≤ 760px） | 抽屉导航、统计卡片重排、项目卡片列表 |

Fluent-inspired 设计参数集中在 `apps/admin/src/styles/tokens.css`。Naive UI 主题和业务样式从同一组 CSS Variables 读取圆角、颜色和间距，避免各页面独立维护第二套设计参数。

## URL 行为

假设订阅 ID 为 `667`，订阅域名为 `gkd.example.com`：

| URL | 浏览器 | GKD / 非 HTML 客户端 |
|---|---|---|
| `https://667.gkd.example.com/` | dist 文件目录 | HTML 目录 |
| `/gkd.json5` | JSON5 代码预览 | 原始 JSON5 |
| `/README.md` | Markdown 渲染 | 原始 Markdown |
| `/gkd.json5?raw=1` | 原始 JSON5 | 原始 JSON5 |

以 `Accept` 请求头协商表示形式，不依赖 User-Agent。若某个客户端发送 `Accept: text/html`，可加 `?raw=1` 强制原文。

## 技术栈

- **运行与包管理**：Bun（依赖管理、脚本、工作区）；Cloudflare Worker 仍运行在 workerd，不运行在 Bun runtime。
- **前端**：Vue 3、Vite、Naive UI、Vue Router、Pinia。
- **后端**：Cloudflare Workers、Hono、KV。
- **质量工具**：Biome（JS/TS/JSON 等支持范围）、vue-tsc（Vue SFC 类型检查）、Vitest。
- **内容处理**：markdown-it。

Biome 不负责 Vue SFC 的完整语义检查；Vue 组件类型检查由 vue-tsc 承担。

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
- Cloudflare 账号，以及托管在 Cloudflare DNS 的域名
- GitHub 公开仓库

### 1. 安装依赖

在仓库根目录执行：

```bash
bun install
```

首次安装会生成 `bun.lock`，请将其提交到 Git。之后可使用 `bun install --frozen-lockfile` 保证依赖解析可复现。

### 2. 创建 KV

```bash
bunx wrangler kv namespace create STATE
```

将返回的 ID 填入 `wrangler.jsonc` 的 `kv_namespaces[0].id`。

### 3. 配置域名

修改 `wrangler.jsonc` 中的：

- `ADMIN_HOST`：管理站完整域名，如 `manage.example.com`
- `SUBSCRIPTION_DOMAIN`：订阅域名后缀，如 `gkd.example.com`
- KV namespace ID

在 Cloudflare DNS 中配置代理记录和 Worker Routes：

- `manage.example.com/*`
- `*.gkd.example.com/*`

TLS 证书必须覆盖对应主机名。二级子域名的证书覆盖范围要单独核实。

### 4. 设置 Secret

```bash
bunx wrangler secret put ADMIN_PASSWORD
```

可选 GitHub Token（提高 API 速率限制）：

```bash
bunx wrangler secret put GITHUB_TOKEN
```

不要将 Secret、Token 或 `.dev.vars` 提交到 Git。

### 5. 本地开发

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

### 6. 检查与部署

```bash
bun run lint
bun run typecheck
bun run test
bun run build:admin
bun run deploy
```

部署命令会先构建 Vue 静态资源，再生成 Worker 类型并调用 Wrangler 部署。Cloudflare Worker Static Assets 负责托管前端，Worker 继续处理 API 和订阅分发。

### 7. 注册订阅

访问管理站，输入管理员密码，添加公开仓库 URL，例如：

`https://github.com/Lin-arm/GKD_subscription`。

服务将提取 ID、检查分支、dist 文件树和 Actions 工作流。相同 ID 不允许重复注册。

## 管理 API

所有 API 需请求头 `Authorization: Bearer <ADMIN_PASSWORD>`。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/projects` | 项目列表 |
| POST | `/api/projects` | 注册项目，JSON：`{"url":"https://github.com/owner/repo"}` |
| POST | `/api/projects/:id/refresh` | 立即刷新 |
| DELETE | `/api/projects/:id` | 删除项目元数据 |

## 更新预测的边界

目前 cron 字段用于识别和展示工作流调度配置；预测间隔主要依据最近成功的 workflow run 完成时间中位数，不是完整 cron 语法解释器。排队延迟、手动触发、取消运行和 GitHub 服务延迟都会影响预测。预测时间不等于上游内容发布时间保证。

## 安全与数据

KV 保存项目索引和元数据；订阅文件从公开 GitHub raw 按需读取。管理密码和 GitHub Token 使用 Worker Secrets。Worker 不修改上游仓库，不需要 Webhook。

## License

MIT，见 [LICENSE](./LICENSE)。
