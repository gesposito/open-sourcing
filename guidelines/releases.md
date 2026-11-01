# Releases

A release is the moment a compromise turns into a supply-chain attack. The goal: no
long-lived publish credentials, two people for every release, and artifacts that users can
verify came from this repository's release workflow.

Template: [`templates/repo/.github/workflows/release.yml`](../templates/repo/.github/workflows/release.yml)
(install it with `oss init --release`).

```
 build (contents: read, no secrets, no cache)
   │  artifact
   ▼
 publish  ── environment: release ── (required reviewer ≠ triggering user, main only)
   │          id-token: write, attestations: write
   │          Trusted Publishing + Sigstore attestation
   ▼
 github-release (contents: write)
              creates the tag and an immutable GitHub release.
              Tag creation succeeds only because `publish` deployed to `release` (REL-06).
```

### REL-01: Use Trusted Publishing, with no long-lived registry tokens (MUST)

*Sources: [Astral], [StarSling] #15*

Publish to PyPI, crates.io, npm (and every other registry that supports it) with
[Trusted Publishing](https://repos.openssf.org/trusted-publishers-for-all-package-repositories.html)
(OIDC). Restrict the trusted publisher to this repository, the release workflow file, and
the `release` environment. Where a registry has no OIDC support, keep the token in the
`release` environment only (GHA-06), with the narrowest scope the registry allows.

- npm needs npm ≥ 11.5.1 and Node ≥ 22.14. Publishing through trusted publishing from a
  public repo generates provenance automatically.
- PyPI: `pypa/gh-action-pypi-publish`. crates.io: `rust-lang/crates-io-auth-action`. Pin
  both (GHA-02).

### REL-02: Attest what you ship (MUST for binaries and images)

*Source: [Astral]*

Generate Sigstore build-provenance attestations for release binaries and container images
(`actions/attest`) so users can run `gh attestation verify <file> --repo owner/repo`.
Publish package-registry attestations too where the ecosystem supports them (npm
provenance, PEP 740 on PyPI).

### REL-03: Turn on immutable releases (MUST)

*Source: [Astral]*

Turn on [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases).
Once a release is published, its assets and tag can't change, which defeats force-push and
asset-swap attacks. Upload assets while the release is still a draft (`gh release create`
with files does this) and publish it last.

### REL-04: No caches in release builds (MUST)

*Source: [Astral]. See GHA-08.*

Build release artifacts from a clean environment. Never restore a cache that a
lower-trust workflow could have written.

### REL-05: Gate releases behind a protected `release` environment (MUST)

*Source: [Astral]*

- Every job that holds release credentials (OIDC or secrets) runs in the `release`
  environment.
- Required reviewers: at least one *other* privileged maintainer, with **Prevent
  self-review** turned on. An attacker then needs two accounts, each with strong 2FA.
- Deployment branches: `main` only (protected branches or a custom policy).
- Release secrets, if any, live only in this environment.

`oss repo-check` verifies all of this.

### REL-06: Tags can only be created by a successful release (MUST)

*Source: [Astral]*

Ruleset [`tag-requires-release`](../templates/rulesets/tags-require-release.json) adds
`required_deployments: [release]` to every tag. A tag can only point at a commit that
deployed to `release` successfully, so the tag must be created in a job *after* the
publishing job (see the template). Apply it with `oss rulesets --release-gate` once the
release workflow follows this shape. Before that, it blocks all tag creation.

### REL-07: Collect approvals once in repos with many release jobs (MAY)

*Source: [Astral]*

When many jobs need `release`, approving each one is noisy. Astral approves once through a
`release-gate` environment, and a small GitHub App
([ost-environment-gate](https://github.com/open-security-tools/ost-environment-gate))
then approves `release` through a custom deployment protection rule.

### REL-08: Embed checksums in standalone installers (SHOULD)

*Source: [Astral]*

If you ship a `curl | sh`-style installer, embed the expected checksum of each binary.
This matters most when the installer is vendored or mirrored elsewhere, since the
installer and the binaries otherwise come from the same host.

### REL-09: Push follow-up changes through narrow bot identities (SHOULD)

*Source: [Astral]*

Version manifests, docs, and pre-commit mirrors updated after a release are pushed by
dedicated bot accounts, using fine-grained PATs scoped to the target repo and kept in the
`release` environment. Never use a maintainer's personal token.

### REL-10: Release from CI, never from a workstation (MUST)

*Source: [Astral]*

Local releases bypass every control above and need long-lived credentials on a laptop.

### REL-11: Code-sign platform binaries (MAY)

*Source: [Astral] (planned there)*

Plan for official code signing on macOS and Windows when you distribute native binaries.
