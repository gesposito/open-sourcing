# Ruleset templates

Adapted from Astral's [example rulesets](https://gist.github.com/woodruffw/643a6cf70ad72d404ce6f9f333181cf8).
They are repo-level (no `repository_name` condition). `oss rulesets --org <org>` adds the
repository condition when it applies them as org rulesets.

| File | Ruleset | Rule | Default |
| --- | --- | --- | --- |
| `branches-main.json` | `branches-main` | REPO-03 | ✅ |
| `branches-disallow-advisory.json` | `no-push-advisory-branches` | REPO-04 | ✅ |
| `branches-disallow-internal.json` | `no-push-internal-branches` | REPO-04 | ✅ |
| `tags-are-immutable.json` | `tags-are-immutable` | REPO-05 | ✅ |
| `tags-require-release.json` | `tag-requires-release` | REL-06 | opt-in (`--release-gate`) |

All of them have empty `bypass_actors` (REPO-06). You can also import them by hand in
Settings → Rules → Rulesets → New ruleset → Import a ruleset.
