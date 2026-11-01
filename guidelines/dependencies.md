# Dependencies

### DEP-01: Automate updates and alerts, including for Actions (MUST)

*Source: [Astral]*

Use Dependabot or Renovate for every ecosystem in the repo, **including
`github-actions`**, so SHA pins (GHA-02) don't go stale. Turn on Dependabot alerts
(REPO-09). Template: [`templates/repo/.github/dependabot.yml`](../templates/repo/.github/dependabot.yml).

### DEP-02: Apply a cooldown to new versions (MUST)

*Source: [Astral] (see also [We should all be using dependency cooldowns](https://blog.yossarian.net/2025/11/21/We-should-all-be-using-dependency-cooldowns))*

Most malicious releases are found and yanked within days. Don't adopt a version until it
has been public for a while. **Our default is 7 days.** Relax it for first-party
dependencies.

| Tool | Setting |
| --- | --- |
| Dependabot | `cooldown: { default-days: 7 }` per `updates` entry; add `exclude` for first-party packages. Security updates are not delayed. |
| Renovate | `minimumReleaseAge: "7 days"`; use `packageRules` to relax it for first-party groups |
| uv | `exclude-newer` (relative durations such as `"7 days"`) |
| Bun | `bunfig.toml` → `[install] minimumReleaseAge = 604800` (this repo uses it) |
| pnpm | `minimumReleaseAge` (minutes) in `pnpm-workspace.yaml` |

`oss audit` flags Dependabot `updates` entries without a `cooldown`.

### DEP-03: Be conservative about dependencies (SHOULD)

*Source: [Astral]*

- Add dependencies deliberately, and remove them where practical.
- Avoid dependencies that ship binary blobs.
- Review dependency features and turn off the ones you don't need.

### DEP-04: Engage upstream (SHOULD)

*Source: [Astral]*

When a dependency's CI or release process is weak, contribute the fix (pinning,
permissions, Trusted Publishing). Build relationships with your ecosystem's security teams
(for Python: PyPA, PSRT), and fund the projects you rely on where you can.
