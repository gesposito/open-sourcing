# Guidelines

These are the rules we follow before and after we make a repository public.
Each rule has a stable ID (`GHA-04`, `REL-05`, …). The `oss` CLI uses those IDs in its
findings, and pull requests can cite them.

| Area | File | Covers |
| --- | --- | --- |
| GitHub Actions | [github-actions.md](github-actions.md) | Workflow security (triggers, pinning, permissions, secrets, caches), plus CI hygiene and speed |
| Repository & organization | [repository-and-org.md](repository-and-org.md) | Accounts, 2FA, rulesets, default token permissions |
| Releases | [releases.md](releases.md) | Trusted Publishing, attestations, release environments, immutable tags and releases |
| Dependencies | [dependencies.md](dependencies.md) | Update automation, cooldowns, dependency policy |
| Automation | [automation.md](automation.md) | GitHub Apps, and work that should not run in Actions |

For a step-by-step pass over one repository, use the
[open-sourcing checklist](../checklists/open-sourcing.md).

## Rule levels

- **MUST**: required. An exception needs a written justification in the PR that adds it,
  plus an inline `# oss-ignore: <rule>` comment where the tool flags it.
- **SHOULD**: the default. Skip it only when you have a clear reason.
- **MAY**: optional, but recommended once the basics are in place.

## Where the rules come from

Every rule cites at least one adopted reference. References are listed in
[`references/`](../references/README.md), each with what we took from it and where we
deviate.

| Tag | Reference |
| --- | --- |
| **[Astral]** | [Open source security at Astral](https://astral.sh/blog/open-source-security-at-astral), William Woodruff, 2026-04-08 |
| **[StarSling]** | [GitHub Actions best practices](https://starsling.dev/best-practices/github-actions), StarSling, last updated 2026-10-22 |

### When references disagree

We adopt the **stricter** rule and record the deviation in the reference's notes. Current
examples:

- **`pull_request_target`**: StarSling allows it for metadata-only jobs. Astral bans it
  org-wide. We ban it (GHA-01).
- **Top-level permissions**: StarSling recommends `contents: read`. Astral starts every
  workflow at `permissions: {}`. We use `{}` (GHA-04).
- **Caching**: StarSling recommends caching dependencies for speed. Astral bans caches in
  release builds. We cache in CI and never in privileged jobs (GHA-08, GHA-24).

## Adding a new reference

1. Add `references/<slug>.md` using the template in [`references/README.md`](../references/README.md).
2. Map each takeaway either to an existing rule ID (add the new tag to its sources) or to a
   new rule ID in the right guideline file.
3. If a rule can be checked mechanically, add it to `src/rules/` with a test in `test/`.
4. Update the tables above.
