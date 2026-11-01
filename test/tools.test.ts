import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit } from "../src/audit.ts";
import { explain, listRules } from "../src/explain.ts";
import type { Api, ApiResponse } from "../src/gh.ts";
import { parseRepo } from "../src/gh.ts";
import { init } from "../src/init.ts";
import { repoCheck } from "../src/repo-check.ts";
import { applyPlan, planRulesets, renderRulesets } from "../src/rulesets.ts";

/** Fake `gh api`: maps "METHOD path" (or just path for GET) to a response. */
function fakeApi(routes: Record<string, ApiResponse | ((body: unknown) => ApiResponse)>, calls: string[] = []): Api {
  return (async (path: string, init?: { method?: string; body?: unknown }) => {
    const key = `${init?.method ?? "GET"} ${path}`;
    calls.push(key);
    const r = routes[key] ?? routes[path];
    if (!r) return { status: 404, data: { message: "Not Found" } };
    return typeof r === "function" ? r(init?.body) : r;
  }) as Api;
}

describe("rulesets", () => {
  test("repo scope: four default rulesets, no repository condition, no bypass", () => {
    const rs = renderRulesets({ scope: { kind: "repo", owner: "o", repo: "r" } });
    expect(rs.map((r) => r.name).sort()).toEqual(["branches-main", "no-push-advisory-branches", "no-push-internal-branches", "tags-are-immutable"]);
    for (const r of rs) {
      expect(r.conditions).not.toHaveProperty("repository_name");
      expect(r.bypass_actors).toEqual([]);
      expect(r.enforcement).toBe("active");
    }
  });

  test("--release-gate adds tag-requires-release with the chosen environment", () => {
    const rs = renderRulesets({ scope: { kind: "repo", owner: "o", repo: "r" }, releaseGate: true, environment: "publish" });
    const gate = rs.find((r) => r.name === "tag-requires-release")!;
    expect(gate.rules.find((r) => r.type === "required_deployments")!.parameters).toEqual({ required_deployment_environments: ["publish"] });
  });

  test("org scope adds repository_name condition", () => {
    const all = renderRulesets({ scope: { kind: "org", org: "acme" } });
    expect(all[0]!.conditions.repository_name).toEqual({ include: ["~ALL"], exclude: [], protected: false });
    const some = renderRulesets({ scope: { kind: "org", org: "acme", repos: ["a", "b"] } });
    expect((some[0]!.conditions.repository_name as { include: string[] }).include).toEqual(["a", "b"]);
  });

  test("templates are not mutated across renders", () => {
    renderRulesets({ scope: { kind: "org", org: "acme" } });
    const again = renderRulesets({ scope: { kind: "repo", owner: "o", repo: "r" } });
    expect(again[0]!.conditions).not.toHaveProperty("repository_name");
  });

  test("plan creates missing, updates same-name repo rulesets, skips inherited org ones", async () => {
    const api = fakeApi({
      "repos/o/r/rulesets?includes_parents=true&per_page=100": {
        status: 200,
        data: [
          { id: 1, name: "branches-main", source_type: "Repository" },
          { id: 2, name: "tags-are-immutable", source_type: "Organization" },
        ],
      },
    });
    const scope = { kind: "repo" as const, owner: "o", repo: "r" };
    const plan = await planRulesets(api, scope, renderRulesets({ scope }));
    const byName = Object.fromEntries(plan.map((p) => [p.payload.name, p]));
    expect(byName["branches-main"]).toMatchObject({ action: "update", existingId: 1 });
    expect(byName["tags-are-immutable"]!.action).toBe("skip");
    expect(byName["no-push-advisory-branches"]!.action).toBe("create");
  });

  test("apply never touches skipped rulesets", async () => {
    const calls: string[] = [];
    const scope = { kind: "repo" as const, owner: "o", repo: "r" };
    await applyPlan(fakeApi({}, calls), scope, [{ payload: renderRulesets({ scope })[0]!, action: "skip" }]);
    expect(calls).toEqual([]);
  });

  test("apply POSTs new and PUTs existing", async () => {
    const calls: string[] = [];
    const api = fakeApi(
      {
        "POST repos/o/r/rulesets": { status: 201, data: { id: 9 } },
        "PUT repos/o/r/rulesets/1": { status: 200, data: { id: 1 } },
      },
      calls,
    );
    const scope = { kind: "repo" as const, owner: "o", repo: "r" };
    const [a, b] = renderRulesets({ scope });
    const log = await applyPlan(api, scope, [
      { payload: a!, action: "update", existingId: 1 },
      { payload: b!, action: "create" },
    ]);
    expect(calls).toEqual(["PUT repos/o/r/rulesets/1", "POST repos/o/r/rulesets"]);
    expect(log.every((l) => !l.includes("failed"))).toBe(true);
  });
});

describe("repo-check", () => {
  const base = "repos/acme/lib";
  const happy: Record<string, ApiResponse> = {
    [base]: { status: 200, data: { default_branch: "main", owner: { type: "Organization" }, permissions: { admin: true } } },
    [`${base}/actions/permissions`]: { status: 200, data: { enabled: true, sha_pinning_required: true } },
    [`${base}/actions/permissions/workflow`]: { status: 200, data: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false } },
    "orgs/acme": { status: 200, data: { two_factor_requirement_enabled: true } },
    [`${base}/vulnerability-alerts`]: { status: 204, data: null },
    [`${base}/immutable-releases`]: { status: 200, data: { enabled: true, enforced_by_owner: false } },
    [`${base}/environments?per_page=100`]: {
      status: 200,
      data: {
        environments: [
          {
            name: "release",
            protection_rules: [{ type: "required_reviewers", prevent_self_review: true, reviewers: [{ type: "User" }] }],
            deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
          },
        ],
      },
    },
    [`${base}/environments/release/deployment-branch-policies?per_page=100`]: { status: 200, data: { branch_policies: [{ name: "main", type: "branch" }] } },
    [`${base}/actions/secrets`]: { status: 200, data: { total_count: 0, secrets: [] } },
    [`${base}/actions/organization-secrets`]: { status: 200, data: { total_count: 0, secrets: [] } },
    [`${base}/rules/branches/main`]: { status: 200, data: [{ type: "deletion" }, { type: "non_fast_forward" }, { type: "pull_request" }] },
    [`${base}/rules/branches/advisory-oss-check`]: { status: 200, data: [{ type: "creation" }] },
    [`${base}/rules/branches/ghsa-oss-check`]: { status: 200, data: [{ type: "creation" }] },
    [`${base}/rules/branches/internal/oss-check`]: { status: 200, data: [{ type: "creation" }] },
    [`${base}/rulesets?includes_parents=true&per_page=100`]: {
      status: 200,
      data: [
        { id: 1, name: "tags-are-immutable", target: "tag", enforcement: "active" },
        { id: 2, name: "tag-requires-release", target: "tag", enforcement: "active" },
      ],
    },
    [`${base}/rulesets/1?includes_parents=true`]: {
      status: 200,
      data: { id: 1, name: "tags-are-immutable", target: "tag", enforcement: "active", source_type: "Organization", conditions: { ref_name: { include: ["~ALL"], exclude: [] } }, rules: [{ type: "deletion" }, { type: "update" }, { type: "non_fast_forward" }], bypass_actors: [] },
    },
    [`${base}/rulesets/2?includes_parents=true`]: {
      status: 200,
      data: { id: 2, name: "tag-requires-release", target: "tag", enforcement: "active", source_type: "Organization", conditions: { ref_name: { include: ["~ALL"], exclude: [] } }, rules: [{ type: "required_deployments", parameters: { required_deployment_environments: ["release"] } }], bypass_actors: [] },
    },
  };

  test("fully hardened repo passes everything", async () => {
    const results = await repoCheck(fakeApi(happy), { owner: "acme", repo: "lib" });
    const bad = results.filter((r) => r.status !== "pass");
    expect(bad).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(15);
  });

  test("defaults and gaps are reported as failures", async () => {
    const results = await repoCheck(
      fakeApi({
        ...happy,
        [`${base}/actions/permissions`]: { status: 200, data: { enabled: true, sha_pinning_required: false } },
        [`${base}/immutable-releases`]: { status: 404, data: null },
        [`${base}/environments?per_page=100`]: { status: 200, data: { environments: [] } },
        [`${base}/actions/secrets`]: { status: 200, data: { secrets: [{ name: "NPM_TOKEN" }] } },
        [`${base}/rulesets?includes_parents=true&per_page=100`]: { status: 200, data: [] },
        [`${base}/rules/branches/main`]: { status: 200, data: [] },
      }),
      { owner: "acme", repo: "lib" },
    );
    const status = Object.fromEntries(results.map((r) => [r.id, r.status]));
    expect(status["actions-sha-pinning"]).toBe("fail");
    expect(status["immutable-releases"]).toBe("fail");
    expect(status["release-environment"]).toBe("fail");
    expect(status["repo-secrets"]).toBe("warn");
    expect(status["default-branch-ruleset"]).toBe("fail");
    expect(status["immutable-tags"]).toBe("fail");
    expect(status["tag-requires-release"]).toBe("fail");
  });

  test("without admin, admin-only 404s are unknown rather than fail", async () => {
    const results = await repoCheck(
      fakeApi({
        ...happy,
        [base]: { status: 200, data: { default_branch: "main", owner: { type: "User" }, permissions: { admin: false } } },
        [`${base}/immutable-releases`]: { status: 404, data: null },
        [`${base}/vulnerability-alerts`]: { status: 404, data: null },
        [`${base}/actions/permissions`]: { status: 403, data: null },
      }),
      { owner: "acme", repo: "lib" },
    );
    const status = Object.fromEntries(results.map((r) => [r.id, r.status]));
    expect(status["immutable-releases"]).toBe("unknown");
    expect(status["vulnerability-alerts"]).toBe("unknown");
    expect(status["actions-sha-pinning"]).toBe("unknown");
    expect(status["org-2fa"]).toBeUndefined();
  });

  test("plan-gated rulesets (GitHub Free + private repo) are unavailable, not a crash", async () => {
    const gated = { status: 403, data: { message: "Upgrade to GitHub Pro or make this repository public to enable this feature." } };
    const results = await repoCheck(
      fakeApi({
        ...happy,
        [`${base}/rulesets?includes_parents=true&per_page=100`]: gated,
        [`${base}/rules/branches/main`]: gated,
      }),
      { owner: "acme", repo: "lib" },
    );
    const rs = results.filter((r) => ["REPO-03", "REPO-04", "REPO-05", "REL-06"].includes(r.guideline));
    expect(rs.length).toBe(4);
    expect(rs.every((r) => r.status === "unavailable" && r.message.includes("Upgrade to GitHub Pro"))).toBe(true);
  });

  test("plan surfaces the API's reason when rulesets can't be listed", async () => {
    const api = fakeApi({ "repos/o/r/rulesets?includes_parents=true&per_page=100": { status: 403, data: { message: "Upgrade to GitHub Pro" } } });
    const scope = { kind: "repo" as const, owner: "o", repo: "r" };
    expect(planRulesets(api, scope, renderRulesets({ scope }))).rejects.toThrow("Upgrade to GitHub Pro");
  });

  test("approval delegated to a deployment-protection App passes (REL-07)", async () => {
    const results = await repoCheck(
      fakeApi({
        ...happy,
        [`${base}/environments?per_page=100`]: {
          status: 200,
          data: { environments: [{ name: "release", protection_rules: [{ type: "branch_policy" }], deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } }] },
        },
        [`${base}/environments/release/deployment_protection_rules`]: { status: 200, data: { custom_deployment_protection_rules: [{ enabled: true, app: { slug: "gate" } }] } },
      }),
      { owner: "acme", repo: "lib" },
    );
    expect(results.find((r) => r.id === "release-reviewers")!.status).toBe("pass");
  });

  test("self-review allowed fails REL-05", async () => {
    const results = await repoCheck(
      fakeApi({
        ...happy,
        [`${base}/environments?per_page=100`]: {
          status: 200,
          data: { environments: [{ name: "release", protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{}] }], deployment_branch_policy: null }] },
        },
      }),
      { owner: "acme", repo: "lib" },
    );
    const status = Object.fromEntries(results.map((r) => [r.id, r.status]));
    expect(status["release-reviewers"]).toBe("fail");
    expect(status["release-branches"]).toBe("fail");
  });
});

describe("init", () => {
  test("writes base templates, skips existing, and the result audits clean", () => {
    const dir = mkdtempSync(join(tmpdir(), "oss-init-"));
    mkdirSync(join(dir, ".github"), { recursive: true });
    writeFileSync(join(dir, ".github/dependabot.yaml"), "version: 2\nupdates: []\n");
    const r = init({ target: dir, ci: true, release: true });
    expect(r.skipped).toEqual([".github/dependabot.yml"]);
    expect(r.written).toEqual([".github/workflows/zizmor.yml", ".github/workflows/ci.yml", ".github/workflows/release.yml"]);
    expect(readFileSync(join(dir, ".github/dependabot.yaml"), "utf8")).toContain("updates: []");
    // The pre-existing dependabot.yaml was kept, so its gap is (correctly) reported.
    expect(audit(dir).findings.map((f) => f.rule)).toEqual(["dependabot-no-actions"]);
  });

  test("a fresh init audits clean", () => {
    const dir = mkdtempSync(join(tmpdir(), "oss-init-"));
    init({ target: dir, ci: true, release: true });
    expect(audit(dir).findings).toEqual([]);
  });

  test("--force overwrites", () => {
    const dir = mkdtempSync(join(tmpdir(), "oss-init-"));
    init({ target: dir });
    writeFileSync(join(dir, ".github/workflows/zizmor.yml"), "x");
    init({ target: dir, force: true });
    expect(readFileSync(join(dir, ".github/workflows/zizmor.yml"), "utf8")).toContain("zizmor-action");
    expect(existsSync(join(dir, ".github/workflows/release.yml"))).toBe(false);
  });
});

describe("explain", () => {
  test("by guideline id and by rule id", () => {
    expect(explain("GHA-04")).toContain("permissions: {}");
    expect(explain("gha-04")).toContain("GHA-04");
    expect(explain("unpinned-uses")).toContain("GHA-02");
    expect(explain("dependabot-no-cooldown")).toContain("DEP-02");
    expect(explain("NOPE-1")).toBeUndefined();
  });

  test("section stops at the next heading", () => {
    const t = explain("GHA-01")!;
    expect(t).not.toContain("GHA-02");
  });

  test("every rule's guideline exists in the docs", () => {
    for (const line of listRules().split("\n")) {
      const id = line.split(/\s+/)[0]!;
      expect(explain(id) ? id : `missing ${id}`).toBe(id);
    }
  });
});

describe("parseRepo", () => {
  test.each([
    ["owner/repo", "owner", "repo"],
    ["https://github.com/astral-sh/uv", "astral-sh", "uv"],
    ["https://github.com/a/b.git", "a", "b"],
    ["a.b/c-d.e", "a.b", "c-d.e"],
  ])("%s", (input, owner, repo) => {
    expect(parseRepo(input)).toEqual({ owner, repo });
  });

  test("rejects garbage", () => {
    expect(() => parseRepo("nope")).toThrow();
  });
});
