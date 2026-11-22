# 工程手册

本目录保存长期有效的工程约定，不复制源代码，也不把每次排错过程堆进 Agent 提示词。

- [工程标准](./engineering-standards.md)：架构、技术选型、质量门禁。
- [需求工程规范](./requirements.md)：FR/NFR、验收标准、需求追踪和变更控制。
- [架构概览](./architecture-overview.md)：Worker、Admin、KV 与外部服务的数据流。
- [架构审计](./architecture-audit.md)：有证据的现状、问题等级和改进顺序。
- [文档规范](./documentation.md)：README、设计文档、ADR、路线图。
- [AI Agent 工作流](./agent-workflows.md)：AGENTS、Claude Code、提示词与自学习。

## 文档事实优先级

1. 当前代码、测试、部署配置决定“现在是什么”。
2. 已接受 ADR 决定“为什么这样选”。
3. 工程标准规定“新代码如何写”。
4. Roadmap / Issue / PR 记录“计划和进度”。
5. README 面向使用者，不替代内部架构文档。

文档与代码冲突时先核实事实，再修正文档；不能为了文档一致而伪造实现状态。结论需标注证据或待验证状态。

## 官方参考资料

- [Claude Code 最佳实践](https://code.claude.com/docs/en/best-practices)
- [Claude Code 项目记忆与 AGENTS.md](https://code.claude.com/docs/en/memory)
- [OpenAI Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)
- [OpenAI：Rethinking skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)
- [GitHub README 指南](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)
- [Vue 官方测试指南](https://vuejs.org/guide/scaling-up/testing.html)
- [Cloudflare Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
