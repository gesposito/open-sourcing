import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { audit, auditActionText, auditWorkflowText } from "../src/audit.ts";
import { cacheReason, unpinnedReason } from "../src/rules/workflow.ts";
import { workflowRules } from "../src/rules/workflow.ts";
import { badRepo, goodRepo, materialize } from "./fixtures.ts";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

const rulesOf = (findings: { rule: string }[]) => [...new Set(findings.map((f) => f.rule))].sort();

/** A minimal workflow that passes every check; tests mutate it. */
const good = (body = "") => `name: t
on:
  push:
permissions: {}
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
        with:
          persist-credentials: false
${body}`;

describe("audit: fixtures", () => {
  test("bad repo triggers every workflow and repo rule", () => {
    const r = audit(badRepo());
    const hit = new Set(r.findings.map((f) => f.rule));
    for (const rule of workflowRules) expect(hit.has(rule.id) ? rule.id : `missing:${rule.id}`).toBe(rule.id);
    expect(hit.has("dependabot-no-cooldown")).toBe(true);
    expect(hit.has("dependabot-no-actions")).toBe(true);
    expect(r.files).toContain(".github/actions/setup/action.yml");
  });

  test("templates (good repo) produce no findings", () => {
    const r = audit(goodRepo());
    expect(r.findings).toEqual([]);
  });

  test("findings carry line numbers pointing at the offending line", () => {
    const r = audit(badRepo());
    const f = r.findings.find((x) => x.rule === "unpinned-uses" && x.message.includes("actions/checkout@v4"))!;
    expect(f.file).toBe(".github/workflows/bad.yml");
    expect(f.line).toBe(20);
    const trig = r.findings.find((x) => x.rule === "forbidden-trigger" && x.message.includes("workflow_run"))!;
    expect(trig.line).toBe(5);
  });
});

describe("GHA-01 forbidden triggers", () => {
  test.each([
    ["on: pull_request_target", "string form"],
    ["on: [push, workflow_run]", "list form"],
    ["on:\n  pull_request_target:\n    types: [opened]", "map form"],
  ])("%s (%s)", (on) => {
    const f = auditWorkflowText("w.yml", `${on}\npermissions: {}\njobs: {}\n`);
    expect(rulesOf(f)).toContain("forbidden-trigger");
  });

  test("pull_request is fine", () => {
    expect(rulesOf(auditWorkflowText("w.yml", "on: pull_request\npermissions: {}\nconcurrency: x\njobs: {}\n"))).toEqual([]);
  });
});

describe("GHA-02 pinning", () => {
  test.each([
    ["actions/checkout@v4", true],
    ["actions/checkout@main", true],
    ["actions/checkout", true],
    [`actions/checkout@${SHA.slice(0, 7)}`, true],
    [`actions/checkout@${SHA}`, false],
    [`org/repo/path/to/action@${SHA}`, false],
    ["./.github/actions/local", false],
    ["docker://alpine:3", true],
    [`docker://alpine@sha256:${"a".repeat(64)}`, false],
  ])("%s → unpinned=%p", (uses, unpinned) => {
    expect(unpinnedReason(uses) !== undefined).toBe(unpinned);
  });

  test("composite action steps are checked", () => {
    const f = auditActionText("action.yml", "runs:\n  using: composite\n  steps:\n    - uses: foo/bar@v1\n");
    expect(f).toHaveLength(1);
    expect(f[0]!.line).toBe(4);
  });

  test("missing version comment is informational", () => {
    const f = auditWorkflowText("w.yml", good(`      - uses: foo/bar@${SHA}\n`));
    expect(f.map((x) => [x.rule, x.severity])).toEqual([["pin-without-version-comment", "info"]]);
  });
});

describe("GHA-04 / GHA-05 permissions", () => {
  test("missing top-level permissions is an error", () => {
    const f = auditWorkflowText("w.yml", good().replace("permissions: {}\n", ""));
    expect(f.find((x) => x.rule === "top-level-permissions")?.severity).toBe("error");
  });

  test("read-only top-level permissions are a warning (StarSling-compatible, not our policy)", () => {
    const f = auditWorkflowText("w.yml", good().replace("permissions: {}", "permissions:\n  contents: read"));
    expect(f.find((x) => x.rule === "top-level-permissions")?.severity).toBe("warning");
  });

  test("id-token: write at top level is GHA-05, not double-reported as GHA-04", () => {
    const f = auditWorkflowText("w.yml", good().replace("permissions: {}", "permissions:\n  id-token: write"));
    expect(rulesOf(f)).toEqual(["id-token-top-level"]);
  });

  test("id-token: write on a job is fine", () => {
    const f = auditWorkflowText("w.yml", good().replace("      contents: read", "      contents: read\n      id-token: write"));
    expect(f).toEqual([]);
  });
});

describe("GHA-06 secrets", () => {
  test("step-level secret inside an environment job is fine", () => {
    const wf = good(`      - run: ./publish.sh
        env:
          TOKEN: \${{ secrets.TOKEN }}
`).replace("    timeout-minutes: 5", "    timeout-minutes: 5\n    environment: release");
    expect(auditWorkflowText("w.yml", wf)).toEqual([]);
  });

  test("GITHUB_TOKEN does not count as a stored secret", () => {
    const wf = good(`      - run: gh pr list
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`);
    expect(auditWorkflowText("w.yml", wf)).toEqual([]);
  });
});

describe("GHA-08 caches in privileged jobs", () => {
  test.each([
    [{ uses: "actions/cache@x" }, true],
    [{ uses: "actions/cache/restore@x" }, true],
    [{ uses: "Swatinem/rust-cache@x" }, true],
    [{ uses: "actions/setup-node@x" }, true],
    [{ uses: "actions/setup-node@x", with: { "package-manager-cache": false } }, false],
    [{ uses: "actions/setup-node@x", with: { "package-manager-cache": false, cache: "npm" } }, true],
    [{ uses: "astral-sh/setup-uv@x" }, true],
    [{ uses: "astral-sh/setup-uv@x", with: { "enable-cache": "false" } }, false],
    [{ uses: "actions/setup-go@x" }, true],
    [{ uses: "actions/setup-go@x", with: { cache: false } }, false],
    [{ uses: "oven-sh/setup-bun@x" }, true],
    [{ uses: "oven-sh/setup-bun@x", with: { "no-cache": true } }, false],
    [{ uses: "actions/setup-python@x" }, false],
    [{ uses: "actions/setup-python@x", with: { cache: "pip" } }, true],
    [{ uses: "docker/build-push-action@x", with: { "cache-from": "type=gha" } }, true],
    [{ run: "echo" }, false],
  ])("%j → cache=%p", (step, expected) => {
    expect(cacheReason(step) !== undefined).toBe(expected);
  });

  test("caches in unprivileged jobs are allowed (GHA-24)", () => {
    const f = auditWorkflowText("w.yml", good(`      - uses: actions/cache@${SHA} # v5\n`));
    expect(f).toEqual([]);
  });

  test("a job with contents: write is privileged", () => {
    const wf = good(`      - uses: actions/cache@${SHA} # v5\n`).replace("contents: read", "contents: write");
    expect(rulesOf(auditWorkflowText("w.yml", wf))).toEqual(["cache-in-privileged-job"]);
  });
});

describe("hygiene", () => {
  test("reusable-workflow callers don't need timeout-minutes", () => {
    const wf = `on: push\npermissions: {}\njobs:\n  call:\n    uses: ./.github/workflows/x.yml\n`;
    expect(auditWorkflowText("w.yml", wf)).toEqual([]);
  });

  test("job-level concurrency satisfies GHA-21", () => {
    const wf = good().replace("on:\n  push:", "on:\n  pull_request:").replace("    timeout-minutes: 5", "    timeout-minutes: 5\n    concurrency: x");
    expect(auditWorkflowText("w.yml", wf)).toEqual([]);
  });
});

describe("suppression", () => {
  test("# oss-ignore on the line or the line above", () => {
    const above = good(`      # oss-ignore: unpinned-uses
      - uses: foo/bar@v1
`);
    const same = good(`      - uses: foo/bar@v1 # oss-ignore: GHA-02\n`);
    expect(rulesOf(auditWorkflowText("w.yml", above))).toEqual([]);
    expect(rulesOf(auditWorkflowText("w.yml", same))).toEqual([]);
  });

  test("# oss-ignore-file suppresses a rule for the whole file", () => {
    const wf = `# oss-ignore-file: forbidden-trigger -- reviewed in #123\n${good().replace("  push:", "  workflow_run:")}`;
    expect(rulesOf(auditWorkflowText("w.yml", wf))).toEqual([]);
  });

  test("suppressing one rule leaves others", () => {
    const wf = good(`      - uses: foo/bar@v1 # oss-ignore: pin-without-version-comment\n`);
    expect(rulesOf(auditWorkflowText("w.yml", wf))).toEqual(["unpinned-uses"]);
  });
});

describe("repo-level checks", () => {
  const repo = materialize;

  test("no update automation and no zizmor", () => {
    const r = audit(repo({ ".github/workflows/ci.yml": good() }));
    expect(rulesOf(r.findings)).toEqual(["no-update-automation", "zizmor-not-in-ci"]);
  });

  test("renovate without minimumReleaseAge", () => {
    const r = audit(repo({ "renovate.json": "{}", ".github/workflows/z.yml": good("      - run: zizmor .\n") }));
    expect(rulesOf(r.findings)).toEqual(["renovate-no-cooldown"]);
  });

  test("renovate config in package.json counts", () => {
    const r = audit(repo({ "package.json": JSON.stringify({ renovate: { minimumReleaseAge: "7 days" } }) }));
    expect(r.findings).toEqual([]);
  });

  test("unparseable YAML is reported, not thrown", () => {
    const r = audit(repo({ ".github/workflows/x.yml": "on: [push\n", ".github/dependabot.yml": "version: 2\nupdates: []\n" }));
    expect(rulesOf(r.findings)).toContain("parse-error");
  });

  test("auditing a single workflow file", () => {
    const r = audit(join(badRepo(), ".github/workflows/bad.yml"));
    expect(r.files).toEqual(["bad.yml"]);
    expect(r.findings.length).toBeGreaterThan(10);
  });
});
