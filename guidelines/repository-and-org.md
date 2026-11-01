# Repository and organization

Workflow hardening is wasted if an account takeover or a single admin can push a tag,
rewrite `main`, or turn off protections. These rules close that gap.

Check a live repository with `bun src/cli.ts repo-check owner/repo`. Apply the baseline
rulesets with `bun src/cli.ts rulesets` (dry run by default; templates are in
[`templates/rulesets/`](../templates/rulesets/)).

## Plan availability

Several controls depend on the GitHub plan when the repository is **private**. Public
repositories get all of them on every plan. Source: GitHub Docs, checked 2026-11-01
([rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets),
[environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)).

| Control | Public repo | Private repo |
| --- | --- | --- |
| Repo rulesets (REPO-03…05, REL-06) | all plans | Pro, Team, Enterprise |
| Org rulesets (REPO-06) | Team, Enterprise | Team, Enterprise |
| Environments, environment secrets, deployment branches (REL-05, GHA-06) | all plans | Pro, Team, Enterprise |
| Required reviewers, wait timers (REL-05) | all plans | Enterprise only |
| Custom deployment protection rules (REL-07) | all plans | Enterprise only |

In practice, a private repo on GitHub Free can't enforce the REPO and REL rulesets or the
release gate. Apply them after making the repo public, as part of the open-sourcing
checklist, and don't rely on them before then. `oss repo-check` reports these as
`– unavailable` rather than failing.

### REPO-01: Keep privileged accounts to a minimum (MUST)

*Source: [Astral]*

Few people hold org owner or repository admin. Most members get read or write access, and
only to the repositories they work on. Review the owner and admin lists before going
public, and again periodically.

### REPO-02: Require strong 2FA (MUST)

*Source: [Astral]*

Turn on the org policy that requires 2FA, and accept nothing weaker than TOTP (no SMS).
This is stricter than GitHub's default. Encourage passkeys or security keys now, and
require phishing-resistant methods once GitHub can enforce them.

### REPO-03: Protect the default branch with a ruleset (MUST)

*Source: [Astral] (rulesets gist)*

Ruleset [`branches-main`](../templates/rulesets/branches-main.json), which targets
`~DEFAULT_BRANCH`:

- no deletion
- no force pushes (`non_fast_forward`)
- linear history, with squash or rebase merges only
- every change goes through a pull request

Raise `required_approving_review_count` and add `required_status_checks` once the team and
CI are in place.

### REPO-04: Block branches that could leak security work (MUST)

*Source: [Astral]*

Rulesets [`no-push-advisory-branches`](../templates/rulesets/branches-disallow-advisory.json)
(`advisory-*`, `ghsa-*`, `cve-*`) and
[`no-push-internal-branches`](../templates/rulesets/branches-disallow-internal.json)
(`internal/**`) block creating or updating these branches in the public repository.
Security fixes belong in a
[private fork for a GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/collaborating-in-a-temporary-private-fork-to-resolve-a-repository-security-vulnerability),
not in a public branch with a revealing name.

### REPO-05: Make tags immutable (MUST)

*Source: [Astral]*

Ruleset [`tags-are-immutable`](../templates/rulesets/tags-are-immutable.json), which targets
`~ALL` tags, blocks deletion, update, and force push. Once a tag exists, it points at the
same commit forever. Tag *creation* is gated separately by REL-06.

### REPO-06: No bypass, and enforce at the org level (MUST)

*Source: [Astral]*

- Rulesets have an empty `bypass_actors` list, so admins cannot bypass them either.
- Prefer **org-level** rulesets (they apply to many repos, and repo admins can't edit
  them). Repo-level rulesets are the fallback for personal-account repos. `oss rulesets`
  supports both (`--org` / `--repo`).

### REPO-07: Read-only default `GITHUB_TOKEN`, and Actions can't approve PRs (MUST)

*Source: [Astral]*

In Settings → Actions → General (org and repo), set **Workflow permissions** to *Read
repository contents and packages permissions* and leave *Allow GitHub Actions to create
and approve pull requests* off. This backs up GHA-04.

### REPO-08: Require SHA-pinned actions (MUST)

*Source: [Astral]*

In Settings → Actions → General, turn on **Require actions to be pinned to a full-length
commit SHA** (API: `sha_pinning_required`). Unlike linting, this is enforced at run time
and covers nested actions. See GHA-02.

### REPO-09: Turn on Dependabot alerts (MUST)

*Source: [Astral]*

Turn on vulnerability alerts so known-vulnerable dependencies are flagged. Update
automation is covered in [dependencies.md](dependencies.md) (DEP-01).
