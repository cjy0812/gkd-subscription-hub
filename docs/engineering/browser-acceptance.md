# 管理端 MonitoringPage 浏览器验收记录

- 日期：2026-11-25
- 页面：`/admin/monitoring`
- 浏览器：Playwright 1.56.1 驱动的真实 Chromium 浏览器进程（headless）
- 服务：本地 Vite Admin 页面；管理 API 使用固定 fixture 响应，不访问生产项目数据
- 验收提交：`5a5a9d52fc09a9059ac601ff4ec79083ea6b6a5a`
- GitHub Actions：<https://github.com/cjy0812/gkd-subscription-hub/actions/runs/45534139090>
- 截图产物：<https://api.github.com/repos/cjy0812/gkd-subscription-hub/actions/artifacts/14986111920/zip>

## 视口结果

| Viewport | 布局预期         | 结果 |
| -------: | ---------------- | ---- |
|   320 px | 移动端工作流卡片 | PASS |
|   640 px | 移动端工作流卡片 | PASS |
|   641 px | 桌面工作流表格   | PASS |
|   768 px | 桌面工作流表格   | PASS |
|  1024 px | 桌面工作流表格   | PASS |
|  1440 px | 桌面工作流表格   | PASS |

## 检查项

- 展开订阅项目和包含 Run 的工作流
- 超长 owner/repository 名称、workflow 名称和路径、错误信息
- 640/641 px 响应式断点切换
- 键盘 Tab 导航及 `:focus-visible` 焦点指示
- Run 链接的目标 URL、`target="_blank"` 和 `rel="noopener"`
- 每个视口的 `documentElement.scrollWidth` 不超过视口宽度
- 每个视口生成完整页面截图并上传 GitHub Actions artifact

**结果：** 六个视口全部通过；没有发现页面级横向溢出，工作流切换、键盘焦点和 Run 链接检查通过。

## 验收范围说明

这是自动化驱动的实际 Chromium 浏览器验收，不是 DOM 单元测试或仅凭 CI build 结果推断。测试使用 fixture API 数据，重点验证布局和交互行为；尚未覆盖实体 Android/iOS 设备、Firefox、Safari，也不代表对生产数据执行了人工操作。

## PR #39 新增交互验收范围

- 公共订阅页：Run → Job → Step → Log 展开、收起、按需加载与失败重试。
- 管理端：Run 详情抽屉、日志失败重试、移动端项目选择 checkbox 可访问名称。
- 文件预览：canonical 路径与历史版本路径不受冲突的 legacy query 参数覆盖。
- 视口：320、640、641、768、1024、1440 px；检查页面横向溢出与键盘焦点。
- 执行结果：以本 PR 最新提交的 Playwright Chromium acceptance workflow 及其截图 artifact 为准；该记录不把 fixture 浏览器测试描述成真实生产数据验收。

## PR #39 验收结果（最新）

- 日期：2026-11-26（GitHub Actions 时间：2026-11-25 16:51 UTC）
- 验收提交：`71bf8e697b124ef28ba9b2398ddebc9b4018e7ac`
- GitHub Actions：<https://github.com/cjy0812/gkd-subscription-hub/actions/runs/45658383489>
- 截图产物：<https://github.com/cjy0812/gkd-subscription-hub/actions/runs/45658383489/artifacts/15043227953>
- 结果：全部通过（Format、Lint、TypeScript、Tests、Admin Build、Chromium Browser Acceptance）

### 实际浏览器覆盖

| Viewport | MonitoringPage | PublicPortal | 横向溢出 |
| -------: | -------------- | ------------ | -------- |
|   320 px | PASS           | PASS         | 无       |
|   640 px | PASS           | PASS         | 无       |
|   641 px | PASS           | PASS         | 无       |
|   768 px | PASS           | PASS         | 无       |
|  1024 px | PASS           | PASS         | 无       |
|  1440 px | PASS           | PASS         | 无       |

额外检查：

- 管理端 Run 抽屉、Job/Step 展开及日志读取。
- 公共端 Run → Job → Step → Log、失败重试。
- Run 外链目标、`target="_blank"`、`rel="noopener"`。
- 键盘焦点可见性及移动端项目 checkbox 的项目级可访问名称。
- canonical 历史版本路径不受冲突 query 参数覆盖。
- 嵌套 `dist/` 路径保持完整，不会被预览页剥离。
- 每个视口检查页面级横向溢出并生成截图。

本次验收使用固定 API fixture 与真实 Chromium 浏览器进程；不访问生产项目数据。它验证浏览器交互与布局，不替代真实 GKD App 请求头的设备侧验证，也未覆盖 Firefox、Safari 或实体 Android/iOS 设备。

## PR #40 管理端缺陷修复验收（最新）

- 日期：2026-11-26
- 验收提交：`f48e5c6f57b2fc08631e5a488d63d65120dbfcda`
- GitHub Actions：<https://github.com/cjy0812/gkd-subscription-hub/actions/runs/45732757365>
- 截图产物：<https://github.com/cjy0812/gkd-subscription-hub/actions/runs/45732757365/artifacts/15076314818>
- 浏览器：Playwright 1.56.1 驱动的 Chromium headless
- 数据：固定 fixture API；不读取或修改生产订阅数据
- 结果：Format、Lint、Worker/Admin TypeScript、Vitest、Admin Build、Browser Acceptance 全部通过

### PR #40 视口结果

| Viewport | ProjectsPage | SubscriptionPreviewPage | AdminLayout 导航 | 页面横向溢出 |
| -------: | ------------ | ------------------------ | ---------------- | ------------ |
| 320 px   | PASS（移动卡片、Provider fallback、可见操作标签） | PASS（原始 JSON5、内部滚动、页面滚动传递） | PASS（左边缘手势打开左侧抽屉；横向滚动区域不触发抽屉） | 无 |
| 768 px   | PASS（桌面表格、Provider fallback） | PASS（原始 JSON5、内部滚动、页面滚动传递） | PASS（桌面侧栏显示、移动菜单隐藏） | 无 |
| 1024 px  | PASS（桌面表格、Provider fallback） | PASS（原始 JSON5、内部滚动、页面滚动传递） | PASS（桌面侧栏显示、移动菜单隐藏） | 无 |
| 1440 px  | PASS（桌面表格、Provider fallback） | PASS（原始 JSON5、内部滚动、页面滚动传递） | PASS（桌面侧栏显示、移动菜单隐藏） | 无 |

### 额外交互检查

- 移动端项目复选框提供项目 ID 与仓库名称的可访问名称。
- 移动端刷新、复制、目录、删除操作均有可见文字，不依赖 hover Tooltip。
- 缺失 Provider 的旧记录在桌面和移动布局均按 GitHub 显示，并向辅助技术暴露完整名称。
- 320px 触摸事件模拟：从普通左边缘向右滑动打开左侧抽屉；从可横向滚动区域开始的手势不会同时打开抽屉。
- 预览页原始 JSON5 内容可横向滚动；预览卡片滚动到边界后，滚轮事件可以继续滚动外层页面。
- 保留原有 MonitoringPage、PublicPortal 六个视口（320/640/641/768/1024/1440 px）和 canonical 预览路径回归。

**验收边界：** 本次使用真实 Chromium 浏览器进程和模拟触摸事件，不等于实体 Android/iOS 设备验收；未覆盖 Firefox、Safari，也未对生产 D1/R2 或真实订阅数据执行写入。实体触摸设备检查仍是交付后的人工补充项。
