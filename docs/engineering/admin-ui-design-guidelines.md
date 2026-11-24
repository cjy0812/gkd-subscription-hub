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
- JSON5：复用 `src/services/json5.ts` 的有界、非 eval 解析器，使用原生 `<details>/<summary>` 生成只读树形视图；支持键名/值搜索、展开/折叠、类型区分和原始文件入口。500 KB 以上先提供继续结构化解析的选项；解析器仍限制 2 MB、树节点 20,000、嵌套深度 64；超过硬上限或解析失败时提供原始内容入口。
- 只读预览与上游原始文件分离；任何格式化不得改变分发给客户端的字节内容。
- 大文件先按尺寸提示用户选择结构化加载；当前 Worker 服务端树形预览限制 2 MB 输入与 20,000 个节点。超过硬上限显示原始文件。当前尚未实现浏览器端 Web Worker/虚拟滚动，不能将节点上限描述为虚拟化。

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

- `markdown-it` 是当前 Worker HTML 预览路径的合适基础：支持 CommonMark/GFM 表格与扩展、可定制 renderer/highlight hook；保留现有依赖可避免把 Vue 组件体系带入 Worker。VueMarkik 等 Vue VNode renderer 不适用于当前服务端 HTML 响应路径。

- 不采用 `json-editor-vue` / `vue-json-pretty`：当前预览执行在 Worker 静态 HTML 路由，不在 Vue SPA 中；原生 details 树可以避免新增客户端框架依赖，也能复用项目已有 JSON5 parser。
- 不引入 Shiki：当前渲染运行在 Cloudflare Worker 请求路径，使用 `highlight.js/lib/core` + 显式语言子集，避免 Shiki 主题/语法引擎带来的额外 Worker 包体积与初始化成本。

## 上游 Skill 来源

- Addy Osmani, `frontend-ui-engineering`: https://github.com/addyosmani/agent-skills/tree/main/skills/frontend-ui-engineering
- Vercel, `web-design-guidelines`: https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines
- Vercel Web Interface Guidelines snapshot: https://github.com/vercel-labs/web-interface-guidelines/blob/434b7f91364665f2f733b310ec54809bf8f37937/command.md

## 订阅历史的稳定性约束

- 历史版本号以 `dist/gkd.version.json5` 中与订阅 ID 匹配的正整数版本为依据；普通提交不创建新版本。
- 历史文件使用不可变 Commit SHA 和文件 SHA 定位；R2 对象以订阅 ID、版本号为唯一对象键，重复归档必须幂等。
- 读取历史时优先读取并校验 R2 副本，失败时回退同一 Commit 的 Git 文件；绝不回退到当前分支的最新版。
