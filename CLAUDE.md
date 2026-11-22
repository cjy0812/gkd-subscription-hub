# Claude Code Instructions

@AGENTS.md

Claude Code must follow the repository-wide instructions in `AGENTS.md`.

Additional workflow expectations:

- Before editing, inspect the current working tree and relevant source/tests. Do not assume the remote default branch or prior conversation reflects local uncommitted changes.
- For multi-file changes, state a concise implementation plan before editing when operating interactively; then implement in small, reviewable steps.
- Prefer existing project conventions and the smallest coherent patch. Avoid speculative abstractions, dependency churn, and unrelated refactors.
- Use available project scripts for verification. Never report a check as passed unless it was actually run and its exit status was successful.
- Review the final diff for accidental changes, generated files, secrets, and documentation drift.
- Do not deploy, change secrets, or perform destructive operations unless explicitly requested.
