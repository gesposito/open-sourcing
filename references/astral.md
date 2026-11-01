# Open source security at Astral

- **URL:** https://astral.sh/blog/open-source-security-at-astral
- **Author / publisher:** William Woodruff ([@woodruffw](https://github.com/woodruffw)), Astral
- **Published:** 2026-04-08
- **Adopted on:** 2026-11-01
- **Companion:** [example rulesets gist](https://gist.github.com/woodruffw/643a6cf70ad72d404ce6f9f333181cf8),
  vendored into [`templates/rulesets/`](../templates/rulesets/)

## Summary

How Astral (Ruff, uv, ty) secures CI/CD, its GitHub organization, releases, and
dependencies, written in response to the 2024–2026 wave of Actions-driven supply-chain
compromises. The core ideas: ban dangerous triggers, hash-pin everything, start with zero
permissions, move all credentials behind approval-gated deployment environments, make tags
and releases immutable, and adopt new dependency versions only after a cooldown. The
article calls itself a point-in-time snapshot.

## Mapping

| Recommendation | Rule |
| --- | --- |
| Ban `pull_request_target` and `workflow_run` org-wide | GHA-01 |
| Pin actions to full SHAs; zizmor `unpinned-uses` / `impostor-commit`; GitHub SHA-pinning policy; pinact | GHA-02, REPO-08, GHA-09 |
| Hash-pinning doesn't stop mutable downloads; review and fix upstream | GHA-03, DEP-04 |
| Read-only org default; every workflow starts at `permissions: {}` | GHA-04, REPO-07 |
| Environment-scoped secrets rather than org/repo secrets | GHA-06, REL-05 |
| Few admins; most members have read/write on their repos only | REPO-01 |
| 2FA no weaker than TOTP; passkeys planned | REPO-02 |
| `main`: no force push, PRs only | REPO-03 |
| Forbid `advisory-*` / `internal-*` branches | REPO-04 |
| Tags can't be updated or deleted | REPO-05 |
| No admin bypass; enforced at the org level | REPO-06 |
| GitHub App (astral-sh-bot) for tasks Actions can't do safely; Apps need review; Apps don't make untrusted code safe | APP-01, APP-02, APP-03, APP-04 |
| Trusted Publishing for PyPI, crates.io, npm | REL-01 |
| Sigstore attestations for binaries and Docker images | REL-02 |
| Immutable releases | REL-03 |
| No caches in release builds | REL-04, GHA-08 |
| `release` environment, approval by another privileged member | REL-05 |
| `release-gate` environment + ost-environment-gate App for many-job releases | REL-07 |
| Tag creation blocked until the release deployment succeeds; releases only from `main` | REL-06, REL-05 |
| Installer embeds binary checksums | REL-08 |
| Knock-on updates through bot accounts with fine-grained PATs | REL-09 |
| Codesigning (planned) | REL-11 |
| Dependabot and Renovate for updates and alerts | DEP-01, REPO-09 |
| Cooldowns, relaxed for first-party dependencies | DEP-02 |
| Conservative dependency policy (no binary blobs, disable unneeded features) | DEP-03 |
| Upstream contributions, ecosystem relationships, OSS funding | DEP-04 |
| Use CI/CD for releases rather than local machines; respect CI/CD's limits | GHA-10, REL-10 |
| Prefer OIDC; scope unavoidable credentials to gated environments | REL-01, GHA-06 |

## Deviations and additions

- **Cooldown length:** Astral doesn't name a number. We picked **7 days** (DEP-02).
- **Ruleset templates:** the gist hard-codes `repository_name: [ruff, ty, uv]`. Our
  templates are repo-level. `oss rulesets --org` adds repository conditions at apply
  time.
- **`update` rule parameters:** the gist's `update` rules have no `parameters`. We add
  `update_allows_fetch_and_merge: false` explicitly, because the REST schema marks it as
  required once `parameters` is present. The behavior is the same.
- **`tag-requires-release`:** opt-in in our tooling (`--release-gate`), because it blocks
  all tag creation until a release workflow in the right shape exists.

## Revisit

- When GitHub can enforce phishing-resistant 2FA (REPO-02).
- When PyPI Trusted Publishing and PEP 740 attestations work together for Astral's setup.
