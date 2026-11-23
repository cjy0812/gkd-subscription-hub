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

- Markdown：保留现有 `markdown-it`，完善标题、目录锚点、表格、引用、列表、任务列表、代码块与安全链接；代码高亮优先评估 `@shikijs/markdown-it`，但需先验证 Cloudflare Worker 兼容性、冷启动/包体积；若成本过高，使用轻量 `highlight.js`。
- JSON5：首选 `json-editor-vue`（底层 `vanilla-jsoneditor`）+ `json5` parser；其底层类型声明暴露 `parser.parse/stringify`，可适配 JSON5。默认只读，提供 tree/text/table、搜索、格式化；保留原始内容入口；解析失败时展示错误并回退原文。
- 只读预览与上游原始文件分离；任何格式化不得改变分发给客户端的字节内容。
- 大文件设置尺寸保护和虚拟滚动；禁止无上限展开导致页面卡死。

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

## 阅读器依赖选型证据

- `json-editor-vue` 0.19.2：MIT，Vue 2/3，树形/文本/表格模式；底层 `vanilla-jsoneditor` 支持自定义 `JSONParser`（parse/stringify），可注入 `json5`。需在项目 fixture 上验证，不把 npm 宣称的大文件上限当作本项目性能保证。
- `vue-json-pretty` 2.6.0：MIT、零运行时依赖、Vue 3 树形视图，作为简化备选；它本身不解决 JSON5 文本解析与源码模式。
- Markdown 高亮：`@shikijs/markdown-it` 可接入现有 markdown-it；Shiki 的 Worker 包体积与初始化成本必须实测。

## 上游 Skill 来源

- Addy Osmani, `frontend-ui-engineering`: https://github.com/addyosmani/agent-skills/tree/main/skills/frontend-ui-engineering
- Vercel, `web-design-guidelines`: https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines
- Vercel Web Interface Guidelines snapshot: https://github.com/vercel-labs/web-interface-guidelines/blob/434b7f91364665f2f733b310ec54809bf8f37937/command.md
