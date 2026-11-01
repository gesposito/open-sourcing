# GitHub Actions best practices (StarSling)

- **URL:** https://starsling.dev/best-practices/github-actions (Markdown: append `.md`)
- **Author / publisher:** StarSling
- **Last updated:** 2026-10-22 (per-practice pages)
- **Adopted on:** 2026-11-01
- **Companions:** open-source (MIT) agent skills `ci-score`, `ci-secure`, `ci-speedup` at
  https://github.com/starslingdev/skills

## Summary

19 practices in 6 categories: caching and setup, parallelization, trigger scope,
required-check hygiene, runners and queue, and security. Each has a per-practice page with
good and bad YAML, plus a "verify on your repo" checklist. StarSling sells CI runners, but
the practices here are vendor-neutral. We adopted none of the product recommendations.

## Mapping

| # | Practice | Rule |
| --- | --- | --- |
| 1 | Cut repeated test setup and teardown | GHA-29 |
| 2 | Cache dependencies (keyed on lockfile) | GHA-24 (bounded by GHA-08) |
| 3 | Set `actions/checkout` fetch-depth | GHA-23 |
| 4 | Shard tests across parallel jobs | GHA-25 |
| 5 | Build and test only what changed (with full-run fallback) | GHA-25 |
| 6 | Filter workflows with `paths` / `paths-ignore` | GHA-22 |
| 7 | Cancel superseded runs with `concurrency` | GHA-21 |
| 8 | Keep non-required checks off the critical path | GHA-26 |
| 9 | Cut CI queue time | GHA-28 |
| 10 | Right-size runners | GHA-28 |
| 11 | Bound jobs with `timeout-minutes` | GHA-20 |
| 12 | Replace fixed sleeps with bounded polling | GHA-27 |
| 13 | Wait for container healthchecks | GHA-27 |
| 14 | Least-privilege permissions | GHA-04 |
| 15 | Prevent secret leaks and overexposure | GHA-06, GHA-07, REL-01 |
| 16 | Secure `pull_request_target` | GHA-01 |
| 17 | Prevent cache poisoning | GHA-08 |
| 18 | Pin actions to commit SHAs | GHA-02 |
| 19 | Scope `id-token: write` to the publishing job | GHA-05 |

## Deviations

- **#14:** StarSling's top-level default is `contents: read`. We follow Astral's
  `permissions: {}`. `oss audit` accepts a read-only top-level block as a warning, not an
  error.
- **#16:** StarSling allows `pull_request_target` for metadata-only work on trusted base
  code. We ban it (GHA-01), along with `workflow_run`, and use a GitHub App for that work
  (APP-01).
- **#2 vs. Astral:** dependency caching is fine in ordinary CI, and never allowed in
  privileged or release jobs (GHA-08).
