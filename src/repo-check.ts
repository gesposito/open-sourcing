import type { Api } from "./gh.ts";
import { color } from "./report.ts";

export type Status = "pass" | "fail" | "warn" | "unknown";

export interface CheckResult {
  id: string;
  guideline: string;
  status: Status;
  message: string;
}

type Obj = Record<string, any>;

export interface RepoCheckOptions {
  owner: string;
  repo: string;
  environment?: string;
}

interface Ruleset {
  id: number;
  name: string;
  target: string;
  enforcement: string;
  source_type?: string;
  conditions?: { ref_name?: { include?: string[]; exclude?: string[] } };
  rules?: { type: string; parameters?: Obj }[];
  bypass_actors?: unknown[] | null;
}

/**
 * Checks live repository settings against REPO-*, REL-* and GHA-06 guidelines.
 * Read-only: only GET requests are made.
 */
export async function repoCheck(api: Api, opts: RepoCheckOptions): Promise<CheckResult[]> {
  const { owner, repo } = opts;
  const envName = opts.environment ?? "release";
  const base = `repos/${owner}/${repo}`;
  const results: CheckResult[] = [];
  const add = (id: string, guideline: string, status: Status, message: string) => results.push({ id, guideline, status, message });

  const repoRes = await api<Obj>(base);
  if (repoRes.status !== 200 || !repoRes.data) throw new Error(`Cannot read ${owner}/${repo} (HTTP ${repoRes.status}). Check the name and \`gh auth status\`.`);
  const info = repoRes.data;
  const isAdmin = Boolean(info.permissions?.admin);
  const defaultBranch: string = info.default_branch ?? "main";
  const isOrg = info.owner?.type === "Organization";
  const noAdmin = "requires admin access to verify";

  // REPO-08 / Actions policy
  const perms = await api<Obj>(`${base}/actions/permissions`);
  if (perms.status === 200 && perms.data) {
    if (perms.data.enabled === false) add("actions-sha-pinning", "REPO-08", "pass", "GitHub Actions is disabled for this repository.");
    else if (perms.data.sha_pinning_required === true) add("actions-sha-pinning", "REPO-08", "pass", "Actions must be pinned to full-length commit SHAs.");
    else add("actions-sha-pinning", "REPO-08", "fail", 'Turn on "Require actions to be pinned to a full-length commit SHA" (Settings → Actions → General).');
  } else add("actions-sha-pinning", "REPO-08", "unknown", `Actions policy ${noAdmin}.`);

  // REPO-07
  const wfPerms = await api<Obj>(`${base}/actions/permissions/workflow`);
  if (wfPerms.status === 200 && wfPerms.data) {
    const problems: string[] = [];
    if (wfPerms.data.default_workflow_permissions !== "read") problems.push("default GITHUB_TOKEN permissions are `write` (set to read)");
    if (wfPerms.data.can_approve_pull_request_reviews) problems.push("Actions can create/approve pull requests (turn off)");
    add("default-workflow-permissions", "REPO-07", problems.length ? "fail" : "pass", problems.length ? problems.join("; ") + "." : "Default token is read-only and cannot approve PRs.");
  } else add("default-workflow-permissions", "REPO-07", "unknown", `Workflow permissions ${noAdmin}.`);

  // REPO-02 (org only)
  if (isOrg) {
    const org = await api<Obj>(`orgs/${owner}`);
    const tfa = org.data?.two_factor_requirement_enabled;
    if (tfa === true) add("org-2fa", "REPO-02", "pass", `Organization ${owner} requires 2FA.`);
    else if (tfa === false) add("org-2fa", "REPO-02", "fail", `Organization ${owner} does not require 2FA.`);
    else add("org-2fa", "REPO-02", "unknown", "2FA requirement is only visible to org owners.");
  }

  // REPO-09
  const vuln = await api(`${base}/vulnerability-alerts`);
  if (vuln.status === 204) add("vulnerability-alerts", "REPO-09", "pass", "Dependabot alerts are enabled.");
  else if (vuln.status === 404 && isAdmin) add("vulnerability-alerts", "REPO-09", "fail", "Dependabot alerts are disabled.");
  else add("vulnerability-alerts", "REPO-09", "unknown", `Dependabot alerts ${noAdmin}.`);

  // REL-03
  const imm = await api<Obj>(`${base}/immutable-releases`);
  if (imm.status === 200 && imm.data?.enabled) add("immutable-releases", "REL-03", "pass", "Immutable releases are enabled.");
  else if ((imm.status === 404 || (imm.status === 200 && imm.data?.enabled === false)) && isAdmin)
    add("immutable-releases", "REL-03", "fail", "Immutable releases are disabled (Settings → General → Releases).");
  else add("immutable-releases", "REL-03", "unknown", `Immutable releases ${noAdmin}.`);

  // REL-05
  await checkEnvironment(api, base, envName, defaultBranch, add);

  // GHA-06: repo / org secrets
  const repoSecrets = await api<Obj>(`${base}/actions/secrets`);
  if (repoSecrets.status === 200 && repoSecrets.data) {
    const names: string[] = (repoSecrets.data.secrets ?? []).map((s: Obj) => s.name);
    add("repo-secrets", "GHA-06", names.length ? "warn" : "pass", names.length ? `Repository-level Actions secrets ${names.join(", ")}: move them into deployment environments.` : "No repository-level Actions secrets.");
  } else add("repo-secrets", "GHA-06", "unknown", `Repository secrets ${noAdmin}.`);
  if (isOrg) {
    const orgSecrets = await api<Obj>(`${base}/actions/organization-secrets`);
    if (orgSecrets.status === 200 && orgSecrets.data) {
      const names: string[] = (orgSecrets.data.secrets ?? []).map((s: Obj) => s.name);
      add("org-secrets", "GHA-06", names.length ? "warn" : "pass", names.length ? `Organization secrets visible to this repo: ${names.join(", ")}. Prefer environment secrets.` : "No organization secrets are shared with this repository.");
    } else add("org-secrets", "GHA-06", "unknown", `Organization secrets ${noAdmin}.`);
  }

  // Rulesets (REPO-03..06, REL-06)
  await checkRules(api, base, defaultBranch, envName, isAdmin, add);

  return results;
}

async function checkEnvironment(api: Api, base: string, envName: string, defaultBranch: string, add: (id: string, g: string, s: Status, m: string) => void) {
  const envs = await api<Obj>(`${base}/environments?per_page=100`);
  if (envs.status !== 200 || !envs.data) {
    add("release-environment", "REL-05", "unknown", "Could not list environments.");
    return;
  }
  const env = (envs.data.environments ?? []).find((e: Obj) => e.name === envName);
  if (!env) {
    add("release-environment", "REL-05", "fail", `No \`${envName}\` environment. Create one with required reviewers and a main-only branch policy.`);
    return;
  }

  const reviewers = (env.protection_rules ?? []).find((r: Obj) => r.type === "required_reviewers");
  if (reviewers && (reviewers.reviewers ?? []).length > 0) {
    if (reviewers.prevent_self_review === true) add("release-reviewers", "REL-05", "pass", `\`${envName}\` requires a reviewer, and self-review is prevented.`);
    else add("release-reviewers", "REL-05", "fail", `\`${envName}\` has required reviewers but allows self-review; turn on "Prevent self-review".`);
  } else {
    const custom = await api<Obj>(`${base}/environments/${encodeURIComponent(envName)}/deployment_protection_rules`);
    const apps = (custom.data?.custom_deployment_protection_rules ?? []).filter((r: Obj) => r.enabled);
    if (apps.length)
      add("release-reviewers", "REL-05", "pass", `\`${envName}\` approval is delegated to App(s) ${apps.map((r: Obj) => r.app?.slug).join(", ")} (REL-07); make sure they require a second person.`);
    else add("release-reviewers", "REL-05", "fail", `\`${envName}\` has no required reviewers; anyone with write access can release.`);
  }

  const policy = env.deployment_branch_policy;
  if (!policy) add("release-branches", "REL-05", "fail", `\`${envName}\` can deploy from any branch; restrict it to \`${defaultBranch}\`.`);
  else if (policy.protected_branches) add("release-branches", "REL-05", "pass", `\`${envName}\` deploys only from protected branches.`);
  else {
    const pol = await api<Obj>(`${base}/environments/${encodeURIComponent(envName)}/deployment-branch-policies?per_page=100`);
    const names: string[] = (pol.data?.branch_policies ?? []).filter((p: Obj) => (p.type ?? "branch") === "branch").map((p: Obj) => p.name);
    if (names.length && names.every((n) => n === defaultBranch)) add("release-branches", "REL-05", "pass", `\`${envName}\` deploys only from \`${defaultBranch}\`.`);
    else add("release-branches", "REL-05", "warn", `\`${envName}\` branch policy allows: ${names.join(", ") || "(tag policies only)"}; expected only \`${defaultBranch}\`.`);
  }
}

function coversAllTags(rs: Ruleset): boolean {
  const inc = rs.conditions?.ref_name?.include ?? [];
  const exc = rs.conditions?.ref_name?.exclude ?? [];
  return exc.length === 0 && inc.some((p) => p === "~ALL" || p === "refs/tags/*" || p === "refs/tags/**" || p === "refs/tags/**/*");
}

async function checkRules(api: Api, base: string, defaultBranch: string, envName: string, isAdmin: boolean, add: (id: string, g: string, s: Status, m: string) => void) {
  const types = async (branch: string) => {
    const r = await api<{ type: string; ruleset_source_type?: string }[]>(`${base}/rules/branches/${branch.split("/").map(encodeURIComponent).join("/")}`);
    return r.data ?? [];
  };

  // REPO-03
  const mainRules = await types(defaultBranch);
  const have = new Set(mainRules.map((r) => r.type));
  const missing = ["deletion", "non_fast_forward", "pull_request"].filter((t) => !have.has(t));
  add("default-branch-ruleset", "REPO-03", missing.length ? "fail" : "pass", missing.length ? `\`${defaultBranch}\` is missing rules: ${missing.join(", ")}. Apply \`branches-main\` (oss rulesets).` : `\`${defaultBranch}\` blocks deletion and force pushes and requires PRs.`);

  // REPO-04
  for (const probe of ["advisory-oss-check", "ghsa-oss-check", "internal/oss-check"]) {
    const t = new Set((await types(probe)).map((r) => r.type));
    const ok = t.has("creation");
    add(`blocked-branch:${probe.split(/[-/]/)[0]}`, "REPO-04", ok ? "pass" : "fail", ok ? `Creating \`${probe}\`-style branches is blocked.` : `\`${probe}\`-style branches can be created; apply the no-push-${probe.startsWith("internal") ? "internal" : "advisory"}-branches ruleset.`);
  }

  // Tag rulesets: REPO-05, REL-06, REPO-06
  const list = await api<Ruleset[]>(`${base}/rulesets?includes_parents=true&per_page=100`);
  if (list.status !== 200 || !list.data) {
    add("immutable-tags", "REPO-05", "unknown", "Could not list rulesets.");
    return;
  }
  const details: Ruleset[] = [];
  for (const rs of list.data.filter((r) => r.enforcement === "active")) {
    const d = await api<Ruleset>(`${base}/rulesets/${rs.id}?includes_parents=true`);
    if (d.data) details.push(d.data);
  }
  const tagRules = new Set(details.filter((r) => r.target === "tag" && coversAllTags(r)).flatMap((r) => (r.rules ?? []).map((x) => x.type)));
  const missingTag = ["deletion", "update", "non_fast_forward"].filter((t) => !tagRules.has(t));
  add("immutable-tags", "REPO-05", missingTag.length ? "fail" : "pass", missingTag.length ? `Tags are not immutable (missing ${missingTag.join(", ")} on all tags). Apply \`tags-are-immutable\`.` : "All tags are protected from deletion, update, and force push.");

  const gated = details.some(
    (r) => r.target === "tag" && coversAllTags(r) && (r.rules ?? []).some((x) => x.type === "required_deployments" && (x.parameters?.required_deployment_environments ?? []).includes(envName)),
  );
  add("tag-requires-release", "REL-06", gated ? "pass" : "fail", gated ? `Tag creation requires a successful \`${envName}\` deployment.` : `Tags can be created without a \`${envName}\` deployment. Apply \`tag-requires-release\` (oss rulesets --release-gate).`);

  const relevant = details.filter((r) => r.target === "tag" || r.target === "branch");
  const visible = relevant.filter((r) => Array.isArray(r.bypass_actors));
  const bypassing = visible.filter((r) => (r.bypass_actors ?? []).length > 0);
  if (relevant.length === 0) add("no-bypass", "REPO-06", "fail", "No active rulesets apply to this repository.");
  else if (bypassing.length) add("no-bypass", "REPO-06", "fail", `Rulesets with bypass actors: ${bypassing.map((r) => r.name).join(", ")}.`);
  else if (visible.length < relevant.length) add("no-bypass", "REPO-06", "unknown", `Bypass lists ${isAdmin ? "of org rulesets require org admin" : "require admin access"} to verify.`);
  else add("no-bypass", "REPO-06", "pass", "No ruleset has bypass actors.");

  const repoLevel = relevant.filter((r) => r.source_type === "Repository").map((r) => r.name);
  if (repoLevel.length) add("org-level-rulesets", "REPO-06", "warn", `Repo-level rulesets (editable by repo admins): ${repoLevel.join(", ")}. Prefer org-level rulesets where possible.`);
}

const ICON: Record<Status, string> = {
  pass: color.green("✓"),
  fail: color.red("✗"),
  warn: color.yellow("!"),
  unknown: color.dim("?"),
};

export function formatChecks(slug: string, results: CheckResult[]): string {
  const lines = [color.bold(`Repository settings: ${slug}`), ""];
  for (const r of results) lines.push(`  ${ICON[r.status]} ${color.dim(r.guideline.padEnd(8))} ${r.message}`);
  const n = (s: Status) => results.filter((r) => r.status === s).length;
  lines.push("", `${n("pass")} passed, ${n("fail")} failed, ${n("warn")} warning(s), ${n("unknown")} unknown.`);
  if (n("unknown")) lines.push(color.dim("Unknown checks need admin (or org owner) access with the gh token."));
  return lines.join("\n");
}
