# Notes for agents working in this repo

- Bun + TypeScript, no runtime dependencies. Run `bun run check` (tsc + `bun test` + self-audit) before finishing.
- `guidelines/*.md` is the source of truth. Every rule has an ID (`GHA-NN`, `REPO-NN`, `REL-NN`, `DEP-NN`, `APP-NN`) and cites a reference tag (`[Astral]`, `[StarSling]`). Don't add rules without a source in `references/`.
- When references conflict, adopt the stricter rule and record the deviation in the reference's notes file.
- Automated checks live in `src/rules/` (`workflow.ts` for per-workflow rules, `repo.ts` for cross-file ones). Each needs a test in `test/` and a trigger in `BAD_WORKFLOW` (`test/fixtures.ts`). Fixtures are generated at test time, so never commit intentionally bad YAML (zizmor and the self-audit would flag it). `templates/repo` must stay finding-free.
- `oss explain` extracts sections by heading `### <ID>: …`, so keep that heading format.
- When you change a pinned action in templates or workflows, resolve the SHA with `gh api repos/<o>/<r>/git/ref/tags/<tag>` (deref annotated tags) and keep the `# vX.Y.Z` comment. Respect the 7-day cooldown.
- `repo-check` is GET-only. `rulesets --apply` is the only command that writes to GitHub, and it needs explicit `--apply`.
