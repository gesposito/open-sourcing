# Open-sourcing checklist

Work through this before flipping a repository to public, and re-run the automated parts
regularly afterwards. Each item links to the rule that explains *why*.

`oss` = `bun src/cli.ts` from this repo (or `bun link`, then `oss`).

## 1. Workflows: `oss audit <repo>` passes, `zizmor <repo>` is clean

- [ ] `oss init <repo>` has added Dependabot with cooldowns and the pinned zizmor workflow ([GHA-09], [DEP-01], [DEP-02])
- [ ] No `pull_request_target` / `workflow_run` ([GHA-01])
- [ ] Every `uses:` is pinned to a full SHA with a version comment (`pinact run`) ([GHA-02])
- [ ] Every workflow starts with `permissions: {}`; jobs request only what they use ([GHA-04])
- [ ] `id-token: write` appears only on publishing jobs ([GHA-05])
- [ ] Secrets are step-scoped and live in environments; no `secrets: inherit` ([GHA-06])
- [ ] `persist-credentials: false` on checkouts that don't push ([GHA-07])
- [ ] No caches in release or privileged jobs ([GHA-08])
- [ ] Every job has `timeout-minutes`; PR workflows have `concurrency` ([GHA-20], [GHA-21])
- [ ] Reviewed what each third-party action downloads at runtime ([GHA-03]) *(manual)*

## 2. Repository and org settings: `oss repo-check <owner/repo>` has no ✗

Run this with an admin token, or the admin-only checks come back as `?`.

- [ ] Owners and admins reviewed and minimized ([REPO-01]) *(manual)*
- [ ] Org requires 2FA, TOTP or stronger ([REPO-02])
- [ ] Rulesets applied, ideally org-level, with no bypass actors:
      `oss rulesets --org <org> --repos <repo>` (or `--repo <owner/repo>`), then `--apply` ([REPO-03]–[REPO-06])
- [ ] Default `GITHUB_TOKEN` is read-only; Actions can't approve PRs ([REPO-07])
- [ ] "Require actions to be pinned to a full-length commit SHA" is on ([REPO-08])
- [ ] Dependabot alerts are on ([REPO-09])

## 3. Releases (if the project publishes anything)

- [ ] Release workflow follows the template shape: build → publish (`release` env) → tag and release (`oss init --release`)
- [ ] `release` environment: required reviewer, prevent self-review, `main` only ([REL-05])
- [ ] Trusted Publishing is configured on every registry, and long-lived tokens are revoked ([REL-01])
- [ ] Attestations for binaries and images ([REL-02])
- [ ] Immutable releases are on ([REL-03])
- [ ] After one successful release: `oss rulesets ... --release-gate --apply` ([REL-06])
- [ ] Nobody releases from a laptop ([REL-10]) *(manual)*

## 4. Dependencies

- [ ] Every ecosystem has an update config with a cooldown ([DEP-01], [DEP-02])
- [ ] Dependencies reviewed: no binary blobs, unneeded features off ([DEP-03]) *(manual)*

## 5. Automation

- [ ] Anything that needs to act on outsiders' PRs or issues with a write token runs as a reviewed GitHub App, not in Actions ([APP-01]–[APP-03])

[GHA-01]: ../guidelines/github-actions.md#gha-01-do-not-use-pull_request_target-or-workflow_run-must
[GHA-02]: ../guidelines/github-actions.md#gha-02-pin-every-action-and-reusable-workflow-to-a-full-commit-sha-must
[GHA-03]: ../guidelines/github-actions.md#gha-03-review-what-pinned-actions-download-at-runtime-should
[GHA-04]: ../guidelines/github-actions.md#gha-04-start-every-workflow-at-permissions--must
[GHA-05]: ../guidelines/github-actions.md#gha-05-grant-id-token-write-only-to-the-publishing-job-must
[GHA-06]: ../guidelines/github-actions.md#gha-06-scope-secrets-to-environments-and-steps-must
[GHA-07]: ../guidelines/github-actions.md#gha-07-check-out-with-persist-credentials-false-should
[GHA-08]: ../guidelines/github-actions.md#gha-08-no-caches-in-release-or-other-privileged-jobs-must
[GHA-09]: ../guidelines/github-actions.md#gha-09-run-zizmor-in-ci-and-before-pushing-must
[GHA-20]: ../guidelines/github-actions.md#gha-20-set-timeout-minutes-on-every-job-should
[GHA-21]: ../guidelines/github-actions.md#gha-21-cancel-superseded-pr-runs-with-concurrency-should
[REPO-01]: ../guidelines/repository-and-org.md#repo-01-keep-privileged-accounts-to-a-minimum-must
[REPO-02]: ../guidelines/repository-and-org.md#repo-02-require-strong-2fa-must
[REPO-03]: ../guidelines/repository-and-org.md#repo-03-protect-the-default-branch-with-a-ruleset-must
[REPO-06]: ../guidelines/repository-and-org.md#repo-06-no-bypass-and-enforce-at-the-org-level-must
[REPO-07]: ../guidelines/repository-and-org.md#repo-07-read-only-default-github_token-and-actions-cant-approve-prs-must
[REPO-08]: ../guidelines/repository-and-org.md#repo-08-require-sha-pinned-actions-must
[REPO-09]: ../guidelines/repository-and-org.md#repo-09-turn-on-dependabot-alerts-must
[REL-01]: ../guidelines/releases.md#rel-01-use-trusted-publishing-with-no-long-lived-registry-tokens-must
[REL-02]: ../guidelines/releases.md#rel-02-attest-what-you-ship-must-for-binaries-and-images
[REL-03]: ../guidelines/releases.md#rel-03-turn-on-immutable-releases-must
[REL-05]: ../guidelines/releases.md#rel-05-gate-releases-behind-a-protected-release-environment-must
[REL-06]: ../guidelines/releases.md#rel-06-tags-can-only-be-created-by-a-successful-release-must
[REL-10]: ../guidelines/releases.md#rel-10-release-from-ci-never-from-a-workstation-must
[DEP-01]: ../guidelines/dependencies.md#dep-01-automate-updates-and-alerts-including-for-actions-must
[DEP-02]: ../guidelines/dependencies.md#dep-02-apply-a-cooldown-to-new-versions-must
[DEP-03]: ../guidelines/dependencies.md#dep-03-be-conservative-about-dependencies-should
[APP-01]: ../guidelines/automation.md#app-01-move-privileged-reactions-to-untrusted-events-into-a-github-app-should
[APP-03]: ../guidelines/automation.md#app-03-an-app-does-not-make-untrusted-code-safe-must
