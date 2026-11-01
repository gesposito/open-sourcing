# Automation outside of Actions

### APP-01: Move privileged reactions to untrusted events into a GitHub App (SHOULD)

*Source: [Astral]*

Some jobs can't be done safely in GitHub Actions: commenting on, labeling, or triaging
third-party issues and PRs needs a write token in response to outsider input, which is
exactly what `pull_request_target` and `workflow_run` provide and why GHA-01 bans them.
Astral runs these jobs in a GitHub App (`astral-sh-bot`). The App receives the same webhook
payloads Actions would, without putting privileged credentials next to untrusted code.

### APP-02: Review Apps like any other software (MUST)

*Source: [Astral]*

An App holds sensitive credentials (its private key and installation tokens) and can still
have SQL injection, prompt injection, or other flaws. Give it least-privilege App
permissions, install it only on the repos that need it, and review it as you would any
service you run.

### APP-03: An App does not make untrusted code safe (MUST)

*Source: [Astral]*

Never run contributor code inside the App, or anywhere its credentials are reachable.
Build and test contributor code with `pull_request` (GHA-01), and have the App act only on
data (for example event payloads and job summaries).

### APP-04: Weigh the cost (MAY)

*Source: [Astral]*

An App is something you develop and host. Use one only when the job is worth doing.
Otherwise, drop the job. For Python, [Gidgethub](https://gidgethub.readthedocs.io/) plus
[Mariatta's tutorial](https://github-app-tutorial.readthedocs.io/) is a good starting
point.
