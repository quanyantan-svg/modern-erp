@AGENTS.md

# Claude Code Project Instructions

This is the Modern ERP long-running refactor project.

Before every development task:

1. Read completely:
   - README.md
   - document.md
   - solution.md
   - docs/00-project-status.md
   - docs/02-feature-matrix.md

2. Read the latest 3 existing daily logs under log/.

3. Inspect:
   - git status
   - current branch
   - git log --oneline -10

4. Follow the project's Modern ERP Refactor workflow.

5. Treat repository files and Git history as the source of truth, not previous chat context.

6. Work on one logical task at a time.

7. Verification before implementation for PARTIAL / NOT_VERIFIED features.

8. Do not modify unrelated modules.

9. Do not mark a feature IMPLEMENTED until focused tests and regression tests pass.

10. Do not commit automatically unless explicitly instructed.

11. Production deployment must come from Git. Never directly edit production business code.

12. Do not introduce PostgreSQL, Redis, Express/Koa, Docker, PM2, microservices, or other infrastructure without explicit approval.