# 管理端 UI 设计与实现规范

> 本规范结合项目既定的 Vue 3 + Naive UI + Fluent-inspired 方向，以及 Addy Osmani 的 `frontend-ui-engineering` Skill 和 Vercel `web-design-guidelines` Skill 制定。它们是工程执行规则，不是要求更换现有组件库。

## 设计系统约束

- 继续使用项目已有的单一 CSS Design Tokens；Naive UI themeOverrides 与业务 CSS 必须映射到 Tokens。
- 不另起颜色、圆角、阴影、间距或字体体系；不随意硬编码 hex、任意 px 和临时 CSS 值。
- 视觉语言保持 Fluent-inspired、信息密度适合管理后台；避免模板化 SaaS 卡片堆叠、过度圆角、重阴影、装饰渐变和无意义大留白。
- 页面先表达任务与信息层级，再选择组件；不要把所有数据都塞入卡片。
- 默认中文，面向用户的文案描述用户任务，不暴露内部变量名、API 字段或实现术语。

## 信息架构与布局

- 桌面端使用左侧主导航，主内容区左对齐；移动端使用左侧 Drawer。
- 页面标题、主要操作、筛选区、内容区顺序保持一致；每页仅一个主标题。
- 项目列表优先展示仓库/项目名称、Provider、分支、状态；内部 ID、SHA 等作为次级元信息。
- 表格列按扫描任务排序：识别对象 → 状态/关键指标 → 最近活动 → 操作。窄屏切换为信息优先级一致的紧凑列表/卡片，不横向挤压所有列。
- 主要动作使用清晰文案；次要高频动作可图标化。图标按钮必须有 Tooltip、可访问名称和可见焦点态；危险动作必须确认。
- 桌面端主导航固定在左侧，采用统一线宽的图标轨道；图标按钮必须提供可见 Tooltip、可访问名称和键盘焦点态。移动端改用左侧 Drawer，并恢复文字标签。
- 使用真实数据长度验收，覆盖超长仓库名、长分支、无描述、错误信息、空目录和大量列表。

## 组件与状态

- 组件保持单一职责，优先组合，不堆叠过多配置属性。
- 数据加载/错误处理与展示组件适当分离；避免把 API、状态机和大段模板继续塞进超长页面。
- 每个数据页面明确加载、空、错误、成功、权限失效状态；加载内容优先使用骨架屏。
- 筛选、排序、分页等可分享状态同步到 URL；破坏性操作必须确认或提供撤销。
- 使用 Naive UI 原生组件能力，不引入第二套 UI framework。

## 表单

- 所有输入均有可见标签；placeholder 只提供示例或补充说明，不代替标签。
- 输入项使用准确的 type、name、autocomplete；认证凭据用用户可理解的“管理员密码”，不暴露 Secret/环境变量名。
- 仓库地址解析成功后再加载 Provider 分支列表；分支使用可搜索选择器，显示默认分支，允许明确选择；请求失败必须可重试。
- 校验错误显示在字段附近，提交时定位首个错误；提交请求开始后显示 loading，避免重复提交。

## 可访问性与交互

- 目标 WCAG 2.1 AA：普通文本对比度至少 4.5:1，大文本至少 3:1。
- 所有交互支持键盘；焦点可见；弹窗/抽屉正确管理焦点并限制背景滚动。
- 图标装饰元素对辅助技术隐藏；纯图标按钮有 aria-label；表单控件有 label。
- 不只用颜色表达状态；同时提供文字或图标。
- 尊重 prefers-reduced-motion；动画只用于解释状态变化，避免 transition: all。

## 响应式验收

至少验证 320px、768px、1024px、1440px：

- 无意外横向溢出；长文本有合理换行/截断和完整查看入口。
- 抽屉、对话框和下拉菜单不超出视口。
- 触控目标足够明确；关键操作不依赖 hover。
- 安全区域、滚动容器和固定头部不能遮挡焦点元素。

## 内容阅读器

- Markdown：继续使用现有 `markdown-it`（Worker 服务端渲染）。允许常见 HTML 排版标签，但最终 HTML 必须经过 `sanitize-html` 严格 allowlist 清理；脚本、事件属性、内嵌框架、对象、SVG/MathML、危险 URL 和协议相对 URL 均不得通过。外链强制 `noopener noreferrer`，图片仅允许 HTTPS/相对地址。保留 `highlight.js/lib/core` 显式语言子集、标题目录、代码复制和图片 lazy loading。
- JSON5：浏览器端使用 GKD 专用预览页，类型直接来自官方 `@gkd-kit/api`（`RawSubscription`、`RawApp`、`RawAppGroup`、`RawGlobalGroup`、`RawCategory`），用 `json5` 在独立 Web Worker 解析。应用列表、规则组和规则列表每页 50 项；用户选择应用后才请求规则组，展开规则组后才请求规则摘要，点击单条规则后才请求完整详情。全局规则与分类各自懒加载。
- 原始 JSON5 文本不在解析时复制到主线程；解析输入的 ArrayBuffer 转移给 Worker。原始 JSON5 标签只在用户主动打开时重新请求并显示；切换订阅或离开页面时取消 fetch、终止 Worker、清理待处理任务。Worker 历史快照读取另设 20 MB 服务端流式上限，并且必须有 SHA-256 才能返回内容。
- 大文件保护采用两阶段策略：10 MB 以内自动结构化解析；10–50 MB 显示明确警告，用户主动选择后再解析；超过 50 MB 保留原始文件入口。下载使用 `ReadableStream` 逐块累计字节，不依赖 `Content-Length`；越过自动阈值或硬上限立即取消响应流。这个硬上限是浏览器内存保护，不应描述成无限文件支持。
- 只读预览与上游原始文件分离；格式化不得改变分发给 GKD 客户端的原始字节内容。GKD 客户端原订阅 URL 不重定向；仅浏览器 HTML 导航重定向到预览 SPA。

## 完成交付检查

- [ ] 组件无控制台错误。
- [ ] 键盘 Tab 顺序、焦点、Esc/Enter 行为正常。
- [ ] 图标按钮有 aria-label/Tooltip。
- [ ] 表单有 label、autocomplete 和字段级错误。
- [ ] 320/768/1024/1440px 无关键布局问题。
- [ ] 加载、空、错误、成功、权限失效状态完整。
- [ ] 颜色/间距/字体遵循 Design Tokens。
- [ ] 大列表/大文件有性能保护。
- [ ] 减少动态效果并尊重 prefers-reduced-motion。
- [ ] CI 通过；真实浏览器验收另行记录，不能以 CI 代替。

## CSS 与图标依赖的 ROI 决策

- 图标使用官方 `@lucide/vue` 包，替换组件内维护的 SVG 字符串/路径映射，统一图标来源和 stroke/size 参数。
- 当前项目已经具备 Naive UI 和单一的 CSS Design Tokens。现阶段不叠加 Tailwind/UnoCSS，因为会增加第二套样式语法和构建约束；如后续出现大量重复 CSS 且框架能通过可量化试点减少维护代码，再重新评估。此次保留 Naive UI 与现有 Tokens。

## 阅读器依赖选型证据

- Markdown 保留 Worker 侧 `markdown-it` 服务端 HTML 输出，配合 `sanitize-html` allowlist 过滤；不把 Markdown 原始 HTML 直接交给浏览器执行。
- GKD JSON5 预览直接参考 `gkd-kit/inspect` 的 `SubscriptionPreview.vue`、`SubscriptionDirectoryPreview.vue`、`directory_preview.ts` 与 `JsonPreview.vue`。采用官方 `@gkd-kit/api` 类型，不手工复制不完整的 GKD 数据结构。
- 不使用递归渲染完整 JSON DOM 的方式处理大型订阅；将解析和数据分页放入 Worker，主线程只渲染当前分页和展开详情。保留原始 JSON5 入口供排错和兼容。

## 上游 Skill 来源

- Addy Osmani, `frontend-ui-engineering`: https://github.com/addyosmani/agent-skills/tree/main/skills/frontend-ui-engineering
- Vercel, `web-design-guidelines`: https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines
- Vercel Web Interface Guidelines snapshot: https://github.com/vercel-labs/web-interface-guidelines/blob/434b7f91364665f2f733b310ec54809bf8f37937/command.md

## 订阅历史的稳定性约束

- 历史版本号以 `dist/gkd.version.json5` 中与订阅 ID 匹配的正整数版本为依据；普通提交不创建新版本。
- 历史文件使用不可变 Commit SHA 和文件 Blob SHA 定位，读取时校验 SHA-256；Worker 服务端读取上限为 20 MB，响应体超限立即取消。缺失校验值的旧快照不可读取。
- 本项目严格采用 Git-only，不配置 R2 Bucket、不执行 R2 读写，也不保留任何 R2 归档 API。上游 Git 历史被删除或改写时，历史版本可能不可恢复；明确标记不可用，绝不使用最新版冒充历史版本。
