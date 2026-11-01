# GitHub Actions

CI/CD is where most recent open-source supply-chain compromises started (Ultralytics,
tj-actions, Nx, Trivy). GitHub's defaults are not safe, so a public repository must
override them. Security rules (GHA-01…GHA-10) come first. Hygiene and speed rules
(GHA-20…) follow.

Check a repository with:

```sh
bun src/cli.ts audit path/to/repo   # our policy checks (IDs below)
zizmor path/to/repo                 # deep static analysis (template injection, impostor commits, …)
```

Both should pass in CI. `oss init` installs a pinned zizmor workflow. See
[`templates/repo/.github/workflows/zizmor.yml`](../templates/repo/.github/workflows/zizmor.yml).

---

## Security

### GHA-01: Do not use `pull_request_target` or `workflow_run` (MUST)

*Sources: [Astral], [StarSling] #16 (stricter: banned outright)*

Both triggers run with the base repository's privileges (a write token and secrets) while
an outsider can influence their input. This makes "pwn requests" possible. Astral bans them
across its whole organization. Nearly every use case has a safe alternative:

| Want to… | Do this instead |
| --- | --- |
| Build or test contributor code | `pull_request` (read-only token, no secrets for forks) |
| Report results back to the PR | [Job summaries](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#adding-a-job-summary) or logs |
| Comment, label, or triage third-party PRs | A GitHub App ([automation.md](automation.md), APP-01) |

Other events an outsider can trigger (`issue_comment`, `pull_request_review`, `issues`)
must treat every input as untrusted data. Never check out, install, or execute anything
they point to.

### GHA-02: Pin every action and reusable workflow to a full commit SHA (MUST)

*Sources: [Astral], [StarSling] #18*

Tags and branches can be changed after the fact (this is how the tj-actions compromise
spread). Pin to the full 40-character SHA and keep the version as a trailing comment, so
Dependabot and Renovate can still propose updates:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

- This applies to every `uses:`: third-party actions, `actions/*`, reusable workflows
  (`jobs.<id>.uses`), and `docker://` images (pin those to an `@sha256:` digest). Local
  actions (`./…`) are exempt.
- Pin automatically with [pinact](https://github.com/suzuki-shunsuke/pinact) (`pinact run`).
- Turn on GitHub's **"Require actions to be pinned to a full-length commit SHA"** policy
  at the org or repo level. It is a hard gate and also covers nested (transitive) actions.
  See REPO-08.
- zizmor's [`impostor-commit`](https://docs.zizmor.sh/audits/#impostor-commit) audit
  catches a SHA that comes from a fork rather than the action's own history.

### GHA-03: Review what pinned actions download at runtime (SHOULD)

*Source: [Astral]*

A pinned action can still fetch mutable content, such as "the latest release" of a
binary. When you adopt an action, read what it downloads. Prefer actions that embed a
URL-to-hash map for the binaries they fetch. When an action falls short, fix it upstream
rather than living with the gap. Example:
[acj/freebsd-firecracker-action#5](https://github.com/acj/freebsd-firecracker-action/pull/5).

The same applies to tools you install in `run:` steps: pin versions (`uvx zizmor@1.31.1`,
not `uvx zizmor`), and avoid action inputs that default to `latest`.

### GHA-04: Start every workflow at `permissions: {}` (MUST)

*Sources: [Astral], [StarSling] #14 (stricter: `{}` rather than `contents: read`)*

Every workflow starts with no `GITHUB_TOKEN` permissions. Each job then asks for only the
scopes it uses. A job-level block **replaces** the top-level one, so re-declare any read
scopes the job still needs.

```yaml
permissions: {}

jobs:
  test:
    permissions:
      contents: read
  comment:
    permissions:
      contents: read
      pull-requests: write
```

- Never use `write-all` or `read-all`.
- Do not grant write scopes to a job that an outsider can trigger or influence. Split the
  work into a separate workflow instead.
- Set the repository or org default to read-only as well (REPO-07). This is
  defense-in-depth for any workflow that slips through without a block.
- Permissions do not make an unsafe trigger safe (see GHA-01).

### GHA-05: Grant `id-token: write` only to the publishing job (MUST)

*Source: [StarSling] #19*

An OIDC token is a publish credential for every registry that trusts the workflow. Declare
`id-token: write` in the publishing job's `permissions:` and never at the top level, so
test, lint, and build jobs (which run dependency code) cannot mint one.

### GHA-06: Scope secrets to environments and steps (MUST)

*Sources: [Astral], [StarSling] #15*

- Prefer short-lived OIDC credentials (Trusted Publishing, cloud OIDC roles) over stored
  secrets.
- Put the secrets that remain in **deployment environments** (for example `release`), not
  at the org or repo level. A compromised test or lint job then has nothing to steal.
  `oss repo-check` warns about repo- and org-level Actions secrets.
- Expose a secret only in the `env:` of the step that uses it. Do not put secrets in
  workflow-level or job-level `env:`.
- Never use `secrets: inherit` (list each secret a reusable workflow needs) or
  `toJSON(secrets)`.
- Never interpolate `${{ secrets.X }}` directly into a `run:` script or command line. Pass
  it through `env:` and reference `"$X"`.
- Keep credentials out of logs, caches, and artifacts. Masking is not a security boundary.
- The `environment:` key does nothing until the environment has protection rules
  configured in settings (REL-05).

### GHA-07: Check out with `persist-credentials: false` (SHOULD)

*Sources: [StarSling] #15 (credentials out of artifacts), zizmor `artipacked`*

By default `actions/checkout` writes the token into `.git/config`, where later steps,
artifacts, and caches can pick it up. Opt out unless the job really needs to `git push`:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  with:
    persist-credentials: false
```

### GHA-08: No caches in release or other privileged jobs (MUST)

*Sources: [Astral], [StarSling] #17*

Caches are shared across trust boundaries. A PR job can write a cache entry that a release
job later restores (cache poisoning). Jobs that publish, deploy, hold `id-token: write`, or
use an `environment:` must not restore caches. Watch for actions that cache **by default**:

| Action | Disable with |
| --- | --- |
| `actions/setup-node` (v5+) | `package-manager-cache: false` |
| `astral-sh/setup-uv` | `enable-cache: false` |
| `oven-sh/setup-bun` | `no-cache: true` |
| `actions/setup-python`, `actions/setup-go`, `actions/setup-java` | don't set `cache:` (`setup-go` caches unless `cache: false`) |
| `actions/cache`, `Swatinem/rust-cache`, … | don't use them in these jobs |

In ordinary CI, cache only inert dependency data (package stores), never executable
workspace state or credentials.

### GHA-09: Run zizmor in CI and before pushing (MUST)

*Source: [Astral]*

[zizmor](https://github.com/zizmorcore/zizmor) finds template injection, excessive
permissions, credential persistence, impostor commits, unpinned uses, dangerous triggers,
and more. Run it on every PR (template: `templates/repo/.github/workflows/zizmor.yml`,
with the zizmor version pinned) and locally (`zizmor .`). `oss audit` complements zizmor:
it encodes *our* policy decisions (for example `permissions: {}` and no caches in release
jobs), while zizmor provides the deep analysis.

### GHA-10: Use CI/CD for releases, and know its limits (MUST)

*Source: [Astral]*

Release from CI, never from a laptop (REL-10). Some tasks cannot be done safely in
Actions, such as commenting on third-party PRs with a write token. Move those out
(APP-01) or don't do them. Don't weaken CI to make them fit.

---

## Hygiene and speed

These come from [StarSling]. They are not security controls, but bounded and predictable
CI is easier to secure and review.

### GHA-20: Set `timeout-minutes` on every job (SHOULD)

*Source: [StarSling] #11*

Without it, a hung job holds a runner for the 360-minute default. Size each limit from
recent successful runtimes plus headroom, and add tighter step-level bounds on steps that
tend to hang (network, integration tests). Reusable-workflow caller jobs (`jobs.<id>.uses`)
cannot set it. Set it inside the called workflow instead.

### GHA-21: Cancel superseded PR runs with `concurrency` (SHOULD)

*Source: [StarSling] #7*

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

Key the group on `github.ref` so unrelated PRs don't share one lane. Never cancel runs on
the default branch or in release workflows.

### GHA-22: Filter triggers with `paths` / `paths-ignore` (MAY)

*Source: [StarSling] #6*

Skip workflows that a change can't affect (for example docs-only changes). Don't
path-filter a workflow whose job is a *required* check: if it never runs, the check never
reports, and the PR is blocked. Make it pass trivially instead.

### GHA-23: Fetch only the history you need (SHOULD)

*Source: [StarSling] #3*

The default `fetch-depth: 1` fits most jobs. Use `2` for a parent diff. Use `0` only for
tooling that walks full history or tags (changelogs, `git describe`).

### GHA-24: Cache dependencies in CI, keyed on the lockfile (SHOULD)

*Source: [StarSling] #2. Bounded by GHA-08.*

Use the setup action's `cache:` input, or `actions/cache` keyed on
`hashFiles('<lockfile>')`. This applies to test and lint jobs, never to release jobs.

### GHA-25: Parallelize long suites (MAY)

*Source: [StarSling] #4, #5*

Shard tests with a `matrix`. In monorepos, build and test only affected packages, and keep
a mandatory full-run fallback so a resolution error never silently skips work.

### GHA-26: Keep advisory checks off the critical path (MAY)

*Source: [StarSling] #8*

Slow, non-required checks that only produce advisory output (size reports, previews) can
be narrowed or made async. Never de-scope a check that runs real tests.

### GHA-27: Poll for readiness instead of sleeping (SHOULD)

*Source: [StarSling] #12, #13*

Replace `sleep N` with bounded polling of the exact condition the test needs, and fail
with diagnostics when the wait times out. Give service containers real healthchecks and
start them with `docker compose up -d --wait`.

### GHA-28: Right-size runners and watch queue time (MAY)

*Source: [StarSling] #9, #10*

GitHub-hosted runners cap concurrent jobs per account (20 on Free). Before downsizing a
runner, run the same commit on both sizes and keep the smaller one only if pass rate and
wall-clock time stay the same.

### GHA-29: Cut repeated test setup (MAY)

*Source: [StarSling] #1*

Do expensive fixture work once per suite or schema, and reset only the state each test
reads.
