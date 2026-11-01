# open-sourcing

Guidelines and tooling for open-sourcing a repository safely, built from references we
have explicitly adopted.

| | |
| --- | --- |
| [`guidelines/`](guidelines/README.md) | The rules, each with a stable ID (`GHA-04`, `REL-05`, …) and its sources |
| [`checklists/open-sourcing.md`](checklists/open-sourcing.md) | Step-by-step pass over one repository |
| [`references/`](references/README.md) | Adopted references: summaries, rule mappings, deviations |
| [`templates/`](templates/) | Rulesets, Dependabot config with cooldowns, a pinned zizmor workflow, a CI skeleton, a gated release workflow |
| `src/` | The `oss` CLI (Bun, no runtime dependencies) |

**Adopted references:**
[Open source security at Astral](https://astral.sh/blog/open-source-security-at-astral) ·
[StarSling: GitHub Actions best practices](https://starsling.dev/best-practices/github-actions)

## Quick start

```sh
bun install
bun src/cli.ts audit ../my-project              # static policy checks (exit 1 on errors)
bun src/cli.ts repo-check my-org/my-project     # live settings check via `gh` (read-only)
bun src/cli.ts rulesets --repo my-org/my-project # dry-run the baseline rulesets
bun src/cli.ts init ../my-project               # add dependabot.yml (cooldown) + pinned zizmor workflow
bun src/cli.ts explain GHA-08                    # print a guideline
```

Or run `bun link` once and use `oss …` from anywhere.

## The `oss` CLI

### `oss audit [paths…]`

Statically checks `.github/workflows/*`, composite `action.yml` files, and Dependabot or
Renovate config against the guidelines. It needs no network or token. `oss rules` lists
the checks.

| Severity | Examples |
| --- | --- |
| error | forbidden triggers (GHA-01), unpinned `uses:` (GHA-02), missing or broad top-level `permissions` (GHA-04), workflow-level `id-token: write` (GHA-05), `secrets: inherit` / `toJSON(secrets)` (GHA-06), caches in privileged jobs, including actions that cache by default (GHA-08) |
| warning | secrets outside environments or in broad `env:` (GHA-06), `persist-credentials` (GHA-07), `latest` tool versions (GHA-03), missing `timeout-minutes` (GHA-20), Dependabot without cooldown (DEP-02), no zizmor in CI (GHA-09) |
| info | missing `concurrency` (GHA-21), `fetch-depth: 0` (GHA-23), SHA pin without a version comment |

Flags: `--format text|json|github` (`github` emits workflow annotations), `--strict`
(warnings fail too), `--min-severity`.

Justified exceptions are suppressed inline, with the reason in the PR:

```yaml
- uses: some/action@v1 # oss-ignore: unpinned-uses -- vendored fork, see #42
# oss-ignore-file: GHA-01 -- applies to the whole file
```

`oss audit` encodes **our** policy decisions. It complements
[zizmor](https://github.com/zizmorcore/zizmor) and does not replace it. Run both (GHA-09).

### `oss repo-check <owner/repo>`

Read-only check of live GitHub settings: SHA-pinning policy, default token permissions,
org 2FA, Dependabot alerts, immutable releases, the `release` environment (reviewers,
self-review, branch policy, or an App-based gate), repo- and org-level secrets, branch
and tag rulesets, bypass actors. Uses your `gh` login. Admin-only settings come back as
`?` without admin rights. Exits 1 if any check fails.

### `oss rulesets (--repo o/r | --org org [--repos a,b])`

Renders the baseline rulesets (adapted from Astral's) and shows a create/update plan.
Nothing changes without `--apply`. `--release-gate` adds `tag-requires-release` (REL-06).
Leave it out until your release workflow creates tags after deploying to `release`.
`--json` prints the payloads.

### `oss init [dir] [--ci] [--release] [--force]`

Copies templates into a repository without overwriting existing files: `dependabot.yml`
and `zizmor.yml` by default, plus `ci.yml` and `release.yml` on request.

## Development

```sh
bun run check   # typecheck + tests + self-audit
zizmor .        # this repo follows its own rules
```

This repo applies a 7-day dependency cooldown through `bunfig.toml` (DEP-02).

To add a reference or rule, see [guidelines/README.md](guidelines/README.md#adding-a-new-reference).
