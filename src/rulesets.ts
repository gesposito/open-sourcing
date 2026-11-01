import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Api } from "./gh.ts";
import { color } from "./report.ts";

export const TEMPLATES_DIR = join(import.meta.dir, "..", "templates");
const RULESETS_DIR = join(TEMPLATES_DIR, "rulesets");

/** Ruleset that blocks tag creation until a release deployment succeeds; opt-in. */
export const RELEASE_GATE = "tag-requires-release";

export interface RulesetPayload {
  name: string;
  target: string;
  enforcement: string;
  conditions: Record<string, unknown>;
  rules: { type: string; parameters?: Record<string, unknown> }[];
  bypass_actors: unknown[];
}

export function loadTemplates(): RulesetPayload[] {
  return readdirSync(RULESETS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(RULESETS_DIR, f), "utf8")) as RulesetPayload);
}

export type Scope = { kind: "repo"; owner: string; repo: string } | { kind: "org"; org: string; repos?: string[] };

export interface RenderOptions {
  scope: Scope;
  releaseGate?: boolean;
  environment?: string;
  /** Use `evaluate` instead of `active` (org rulesets on GitHub Enterprise only). */
  enforcement?: "active" | "evaluate" | "disabled";
}

export function renderRulesets(opts: RenderOptions): RulesetPayload[] {
  const env = opts.environment ?? "release";
  return loadTemplates()
    .filter((t) => opts.releaseGate || t.name !== RELEASE_GATE)
    .map((t) => {
      const rs: RulesetPayload = structuredClone(t);
      if (opts.enforcement) rs.enforcement = opts.enforcement;
      for (const rule of rs.rules) {
        if (rule.type === "required_deployments") rule.parameters = { required_deployment_environments: [env] };
      }
      if (opts.scope.kind === "org") {
        rs.conditions = {
          ...rs.conditions,
          repository_name: { include: opts.scope.repos?.length ? opts.scope.repos : ["~ALL"], exclude: [], protected: false },
        };
      }
      return rs;
    });
}

export interface PlanItem {
  payload: RulesetPayload;
  /** `skip`: a same-name org ruleset already applies to this repo (REPO-06 prefers it). */
  action: "create" | "update" | "skip";
  existingId?: number;
}

function endpoint(scope: Scope): string {
  return scope.kind === "org" ? `orgs/${scope.org}/rulesets` : `repos/${scope.owner}/${scope.repo}/rulesets`;
}

export async function planRulesets(api: Api, scope: Scope, payloads: RulesetPayload[]): Promise<PlanItem[]> {
  const query = scope.kind === "repo" ? "?includes_parents=true&per_page=100" : "?per_page=100";
  const res = await api<{ id: number; name: string; source_type?: string }[]>(`${endpoint(scope)}${query}`);
  if (res.status !== 200 || !Array.isArray(res.data)) {
    const msg = (res.data as { message?: string } | null)?.message;
    throw new Error(`Could not list rulesets at ${endpoint(scope)} (HTTP ${res.status})${msg ? `: ${msg}` : ""}`);
  }
  // For a repo, only its own rulesets can be updated; inherited org rulesets of the same name are left alone.
  const own = new Map(res.data.filter((r) => scope.kind === "org" || r.source_type !== "Organization").map((r) => [r.name, r.id]));
  const inherited = new Set(scope.kind === "repo" ? res.data.filter((r) => r.source_type === "Organization").map((r) => r.name) : []);
  return payloads.map((payload): PlanItem => {
    const id = own.get(payload.name);
    if (id !== undefined) return { payload, action: "update", existingId: id };
    if (inherited.has(payload.name)) return { payload, action: "skip" };
    return { payload, action: "create" };
  });
}

export async function applyPlan(api: Api, scope: Scope, plan: PlanItem[]): Promise<string[]> {
  const log: string[] = [];
  for (const item of plan) {
    if (item.action === "skip") continue;
    const path = item.action === "create" ? endpoint(scope) : `${endpoint(scope)}/${item.existingId}`;
    const res = await api<{ id?: number; message?: string; errors?: unknown }>(path, { method: item.action === "create" ? "POST" : "PUT", body: item.payload });
    if (res.status >= 200 && res.status < 300) log.push(`${color.green("✓")} ${item.action}d ${item.payload.name} (id ${res.data?.id ?? item.existingId})`);
    else log.push(`${color.red("✗")} ${item.action} ${item.payload.name} failed (HTTP ${res.status}): ${res.data?.message ?? ""} ${res.data?.errors ? JSON.stringify(res.data.errors) : ""}`.trim());
  }
  return log;
}
