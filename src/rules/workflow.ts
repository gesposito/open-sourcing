import type { YamlSource } from "../source.ts";
import type { Finding, Severity } from "../types.ts";

type Obj = Record<string, unknown>;

export interface Step {
  uses?: string;
  run?: string;
  with?: Obj;
  env?: Obj;
  [k: string]: unknown;
}

export interface Job {
  "runs-on"?: unknown;
  uses?: string;
  permissions?: unknown;
  environment?: unknown;
  "timeout-minutes"?: unknown;
  concurrency?: unknown;
  env?: Obj;
  secrets?: unknown;
  steps?: Step[];
  [k: string]: unknown;
}

export interface WorkflowContext {
  src: YamlSource;
  wf: Obj;
  jobs: Record<string, Job>;
  triggers: string[];
}

export type Emit = (f: Omit<Finding, "file">) => void;

export interface WorkflowRule {
  id: string;
  guideline: string;
  severity: Severity;
  description: string;
  check(ctx: WorkflowContext, emit: Emit): void;
}

const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /@sha256:[0-9a-f]{64}$/;

export const FORBIDDEN_TRIGGERS = ["pull_request_target", "workflow_run"] as const;

const CACHE_ACTIONS = [
  "actions/cache",
  "swatinem/rust-cache",
  "buildjet/cache",
  "useblacksmith/cache",
  "mozilla-actions/sccache-action",
  "hendrikmuhs/ccache-action",
];

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function triggersOf(on: unknown): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.filter((t): t is string => typeof t === "string");
  if (isObj(on)) return Object.keys(on);
  return [];
}

/** `owner/repo/path@ref` → lowercased `owner/repo/path` without the ref. */
export function actionName(uses: string): string {
  return uses.split("@")[0]!.toLowerCase();
}

function isFalse(v: unknown): boolean {
  return v === false || (typeof v === "string" && v.trim().toLowerCase() === "false");
}

function isTruthyInput(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim() !== "" && v.trim().toLowerCase() !== "false";
  return true;
}

function writeScopes(perms: unknown): string[] {
  if (perms === "write-all") return ["write-all"];
  if (!isObj(perms)) return [];
  return Object.entries(perms)
    .filter(([, v]) => v === "write")
    .map(([k]) => k);
}

/** Permissions effective for a job: its own block, else the workflow's. */
function effectivePerms(ctx: WorkflowContext, job: Job): unknown {
  return job.permissions !== undefined ? job.permissions : ctx.wf.permissions;
}

/** A job is privileged when it can deploy, publish, or write to the repository. */
export function isPrivileged(ctx: WorkflowContext, job: Job): boolean {
  if (job.environment !== undefined && job.environment !== null) return true;
  return writeScopes(effectivePerms(ctx, job)).length > 0;
}

function collectSecretRefs(value: unknown, out: Set<string>) {
  if (typeof value === "string") {
    for (const m of value.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) out.add(m[1]!);
    for (const m of value.matchAll(/secrets\[\s*['"]([^'"]+)['"]\s*\]/g)) out.add(m[1]!);
  } else if (Array.isArray(value)) {
    for (const v of value) collectSecretRefs(v, out);
  } else if (isObj(value)) {
    for (const v of Object.values(value)) collectSecretRefs(v, out);
  }
}

/** Describes why a step restores or writes a cache, or undefined if it doesn't. */
export function cacheReason(step: Step): string | undefined {
  if (!step.uses) return undefined;
  const name = actionName(step.uses);
  const w = isObj(step.with) ? step.with : {};
  if (CACHE_ACTIONS.some((a) => name === a || name.startsWith(a + "/"))) return `\`${name}\` is a cache action`;
  if (name === "actions/setup-node") {
    if (isTruthyInput(w.cache)) return "`actions/setup-node` has `cache:` set";
    if (!isFalse(w["package-manager-cache"]))
      return "`actions/setup-node` (v5+) caches automatically unless `package-manager-cache: false`";
  }
  if (name === "astral-sh/setup-uv" && !isFalse(w["enable-cache"]))
    return "`astral-sh/setup-uv` caches by default unless `enable-cache: false`";
  if (name === "actions/setup-go" && !isFalse(w.cache))
    return "`actions/setup-go` caches by default unless `cache: false`";
  if (name === "oven-sh/setup-bun" && !isTruthyInput(w["no-cache"]))
    return "`oven-sh/setup-bun` caches by default unless `no-cache: true`";
  if (isTruthyInput(w.cache)) return `\`${name}\` has \`cache:\` set`;
  for (const key of ["cache-from", "cache-to"]) {
    const v = w[key];
    if (typeof v === "string" && /type=gha/.test(v)) return `\`${name}\` uses the GitHub Actions cache (\`${key}: type=gha\`)`;
  }
  return undefined;
}

/** Checks a `uses:` value; returns a problem description, or undefined when pinned. */
export function unpinnedReason(uses: string): string | undefined {
  const u = uses.trim();
  if (u.startsWith("./") || u.startsWith(".\\")) return undefined;
  if (u.startsWith("docker://")) {
    return DIGEST_RE.test(u) ? undefined : `container \`${u}\` is not pinned to an \`@sha256:\` digest`;
  }
  const at = u.lastIndexOf("@");
  if (at === -1) return `\`${u}\` has no ref; pin it to a full commit SHA`;
  const ref = u.slice(at + 1);
  if (SHA_RE.test(ref)) return undefined;
  return `\`${u}\` uses mutable ref \`${ref}\`; pin it to a full 40-character commit SHA`;
}

function forEachStep(ctx: WorkflowContext, fn: (jobId: string, job: Job, step: Step, index: number) => void) {
  for (const [jobId, job] of Object.entries(ctx.jobs)) {
    if (!Array.isArray(job.steps)) continue;
    job.steps.forEach((step, i) => {
      if (isObj(step)) fn(jobId, job, step as Step, i);
    });
  }
}

export const workflowRules: WorkflowRule[] = [
  {
    id: "forbidden-trigger",
    guideline: "GHA-01",
    severity: "error",
    description: "Workflows must not use pull_request_target or workflow_run.",
    check(ctx, emit) {
      for (const t of ctx.triggers) {
        if ((FORBIDDEN_TRIGGERS as readonly string[]).includes(t)) {
          emit({
            rule: this.id,
            guideline: this.guideline,
            severity: this.severity,
            message: `\`${t}\` runs with base-repository privileges on outsider-controlled input. Use \`pull_request\`, job summaries, or a GitHub App instead.`,
            line: ctx.src.matchLine(new RegExp(`^\\s*-?\\s*["']?${t}["']?\\s*:?`)) ?? ctx.src.topKeyLine("on"),
          });
        }
      }
    },
  },
  {
    id: "unpinned-uses",
    guideline: "GHA-02",
    severity: "error",
    description: "Every action and reusable workflow must be pinned to a full commit SHA.",
    check(ctx, emit) {
      for (const [jobId, job] of Object.entries(ctx.jobs)) {
        if (typeof job.uses === "string") {
          const reason = unpinnedReason(job.uses);
          if (reason)
            emit({
              rule: this.id,
              guideline: this.guideline,
              severity: this.severity,
              message: `Reusable workflow ${reason}.`,
              line: ctx.src.jobMatchLine(jobId, /^\s*uses\s*:/),
            });
        }
      }
      forEachStep(ctx, (jobId, _job, step, i) => {
        if (typeof step.uses !== "string") return;
        const reason = unpinnedReason(step.uses);
        if (reason)
          emit({
            rule: this.id,
            guideline: this.guideline,
            severity: this.severity,
            message: `Action ${reason}.`,
            line: ctx.src.stepKeyLine(jobId, i, "uses"),
          });
      });
    },
  },
  {
    id: "pin-without-version-comment",
    guideline: "GHA-02",
    severity: "info",
    description: "SHA pins should carry a trailing `# vX.Y.Z` comment so humans and update bots can track them.",
    check(ctx, emit) {
      forEachStep(ctx, (jobId, _job, step, i) => {
        if (typeof step.uses !== "string" || unpinnedReason(step.uses) || step.uses.startsWith("./")) return;
        if (step.uses.startsWith("docker://")) return;
        const line = ctx.src.stepKeyLine(jobId, i, "uses");
        if (line && !/#\s*\S/.test(ctx.src.lines[line - 1]!.split(step.uses)[1] ?? ""))
          emit({
            rule: this.id,
            guideline: this.guideline,
            severity: this.severity,
            message: `\`${actionName(step.uses)}\` is SHA-pinned without a version comment (e.g. \`# v1.2.3\`).`,
            line,
          });
      });
    },
  },
  {
    id: "mutable-tool-version",
    guideline: "GHA-03",
    severity: "warning",
    description: "Tools installed by actions should be pinned, not `latest`.",
    check(ctx, emit) {
      forEachStep(ctx, (jobId, _job, step, i) => {
        if (typeof step.uses !== "string") return;
        const w = isObj(step.with) ? step.with : {};
        for (const [k, v] of Object.entries(w)) {
          if ((k === "version" || k.endsWith("-version")) && typeof v === "string" && v.trim().toLowerCase() === "latest")
            emit({
              rule: this.id,
              guideline: this.guideline,
              severity: this.severity,
              message: `\`${actionName(step.uses)}\` installs \`${k}: latest\`; pin an exact version.`,
              line: ctx.src.stepKeyLine(jobId, i, k),
            });
        }
        if (actionName(step.uses) === "zizmorcore/zizmor-action" && w.version === undefined)
          emit({
            rule: this.id,
            guideline: this.guideline,
            severity: this.severity,
            message: "`zizmorcore/zizmor-action` installs the latest zizmor by default; set `version:` to an exact release.",
            line: ctx.src.stepKeyLine(jobId, i, "uses"),
          });
      });
    },
  },
  {
    id: "top-level-permissions",
    guideline: "GHA-04",
    severity: "error",
    description: "Workflows must start with `permissions: {}`.",
    check(ctx, emit) {
      const p = ctx.wf.permissions;
      const line = ctx.src.topKeyLine("permissions") ?? ctx.src.topKeyLine("on") ?? 1;
      const base = { rule: this.id, guideline: this.guideline, line };
      if (p === undefined) {
        emit({ ...base, severity: "error", message: "No top-level `permissions:`; the token gets the repository default. Add `permissions: {}`." });
        return;
      }
      if (p === "write-all" || p === "read-all") {
        emit({ ...base, severity: "error", message: `Top-level \`permissions: ${p}\`. Use \`permissions: {}\` and grant scopes per job.` });
        return;
      }
      if (!isObj(p)) return;
      const entries = Object.entries(p).filter(([k]) => k !== "id-token"); // id-token handled by GHA-05
      const writes = entries.filter(([, v]) => v === "write").map(([k]) => k);
      if (writes.length)
        emit({
          ...base,
          severity: "error",
          message: `Top-level permissions grant write (${writes.join(", ")}) to every job. Move them to the jobs that need them.`,
        });
      else if (entries.some(([, v]) => v !== "none"))
        emit({
          ...base,
          severity: "warning",
          message: "Top-level permissions are read-only but not empty. Prefer `permissions: {}` and grant `contents: read` per job.",
        });
    },
  },
  {
    id: "job-broad-permissions",
    guideline: "GHA-04",
    severity: "error",
    description: "Jobs must name the scopes they need instead of `write-all` / `read-all`.",
    check(ctx, emit) {
      for (const [jobId, job] of Object.entries(ctx.jobs)) {
        if (job.permissions === "write-all" || job.permissions === "read-all")
          emit({
            rule: this.id,
            guideline: this.guideline,
            severity: job.permissions === "write-all" ? "error" : "warning",
            message: `Job \`${jobId}\` uses \`permissions: ${job.permissions}\`; list only the scopes it needs.`,
            line: ctx.src.jobMatchLine(jobId, /^\s*permissions\s*:/),
          });
      }
    },
  },
  {
    id: "id-token-top-level",
    guideline: "GHA-05",
    severity: "error",
    description: "`id-token: write` belongs on the publishing job only.",
    check(ctx, emit) {
      const p = ctx.wf.permissions;
      if (p === "write-all" || (isObj(p) && p["id-token"] === "write"))
        emit({
          rule: this.id,
          guideline: this.guideline,
          severity: this.severity,
          message: "`id-token: write` at workflow level lets every job mint OIDC publish tokens. Grant it only in the publishing job.",
          line: ctx.src.matchLine(/^\s*id-token\s*:\s*write/) ?? ctx.src.topKeyLine("permissions"),
        });
    },
  },
  {
    id: "secrets-inherit",
    guideline: "GHA-06",
    severity: "error",
    description: "Reusable workflows must receive an explicit list of secrets.",
    check(ctx, emit) {
      for (const [jobId, job] of Object.entries(ctx.jobs)) {
        if (job.secrets === "inherit")
          emit({
            rule: this.id,
            guideline: this.guideline,
            severity: this.severity,
            message: `Job \`${jobId}\` passes \`secrets: inherit\`; enumerate only the secrets the called workflow needs.`,
            line: ctx.src.jobMatchLine(jobId, /^\s*secrets\s*:\s*inherit/),
          });
      }
    },
  },
  {
    id: "secrets-tojson",
    guideline: "GHA-06",
    severity: "error",
    description: "Never serialize the whole secrets context.",
    check(ctx, emit) {
      ctx.src.lines.forEach((l, i) => {
        if (/toJSON\(\s*secrets\s*\)/i.test(l))
          emit({
            rule: this.id,
            guideline: this.guideline,
            severity: this.severity,
            message: "`toJSON(secrets)` exposes every secret to this step.",
            line: i + 1,
          });
      });
    },
  },
  {
    id: "secret-in-broad-env",
    guideline: "GHA-06",
    severity: "warning",
    description: "Secrets belong in the env of the step that uses them, not workflow- or job-wide env.",
    check(ctx, emit) {
      const report = (where: string, env: unknown, line: number | undefined) => {
        const refs = new Set<string>();
        collectSecretRefs(env, refs);
        refs.delete("GITHUB_TOKEN");
        if (refs.size)
          emit({
            rule: this.id,
            guideline: this.guideline,
            severity: this.severity,
            message: `${where} \`env:\` exposes ${[...refs].map((s) => `\`${s}\``).join(", ")} to every step; move it to the consuming step.`,
            line,
          });
      };
      report("Workflow-level", ctx.wf.env, ctx.src.topKeyLine("env"));
      for (const [jobId, job] of Object.entries(ctx.jobs))
        report(`Job \`${jobId}\``, job.env, ctx.src.jobMatchLine(jobId, /^\s{2,}env\s*:/));
    },
  },
  {
    id: "secret-in-run",
    guideline: "GHA-06",
    severity: "warning",
    description: "Pass secrets to scripts via env, not `${{ secrets.* }}` interpolation.",
    check(ctx, emit) {
      forEachStep(ctx, (jobId, _job, step, i) => {
        if (typeof step.run === "string" && /\$\{\{\s*secrets\./.test(step.run))
          emit({
            rule: this.id,
            guideline: this.guideline,
            severity: this.severity,
            message: "`${{ secrets.* }}` is interpolated into a `run:` script; pass it via the step's `env:` and use `\"$NAME\"`.",
            line: ctx.src.stepKeyLine(jobId, i, "run"),
          });
      });
    },
  },
  {
    id: "secrets-without-environment",
    guideline: "GHA-06",
    severity: "warning",
    description: "Jobs that use stored secrets should get them from a protected deployment environment.",
    check(ctx, emit) {
      for (const [jobId, job] of Object.entries(ctx.jobs)) {
        if (job.environment !== undefined && job.environment !== null) continue;
        if (job.uses !== undefined) continue; // reusable-workflow callers: the called workflow owns its environment
        const refs = new Set<string>();
        collectSecretRefs(job, refs);
        refs.delete("GITHUB_TOKEN");
        if (refs.size)
          emit({
            rule: this.id,
            guideline: this.guideline,
            severity: this.severity,
            message: `Job \`${jobId}\` uses ${[...refs].map((s) => `\`${s}\``).join(", ")} without an \`environment:\`. Move the secret(s) to a protected environment (or replace with OIDC).`,
            line: ctx.src.jobLine(jobId),
          });
      }
    },
  },
  {
    id: "checkout-persist-credentials",
    guideline: "GHA-07",
    severity: "warning",
    description: "actions/checkout should set `persist-credentials: false`.",
    check(ctx, emit) {
      forEachStep(ctx, (jobId, _job, step, i) => {
        if (typeof step.uses !== "string" || actionName(step.uses) !== "actions/checkout") return;
        const w = isObj(step.with) ? step.with : {};
        if (!isFalse(w["persist-credentials"]))
          emit({
            rule: this.id,
            guideline: this.guideline,
            severity: this.severity,
            message: "`actions/checkout` leaves the token in `.git/config`; set `persist-credentials: false` unless this job pushes.",
            line: ctx.src.stepKeyLine(jobId, i, "uses"),
          });
      });
    },
  },
  {
    id: "cache-in-privileged-job",
    guideline: "GHA-08",
    severity: "error",
    description: "Release, deploy, and other privileged jobs must not use caches.",
    check(ctx, emit) {
      forEachStep(ctx, (jobId, job, step, i) => {
        if (!isPrivileged(ctx, job)) return;
        const reason = cacheReason(step);
        if (reason)
          emit({
            rule: this.id,
            guideline: this.guideline,
            severity: this.severity,
            message: `Privileged job \`${jobId}\` (environment or write permissions) uses a cache: ${reason}. Caches can be poisoned by lower-trust runs.`,
            line: ctx.src.stepKeyLine(jobId, i, "uses"),
          });
      });
    },
  },
  {
    id: "missing-timeout",
    guideline: "GHA-20",
    severity: "warning",
    description: "Every runner job should set `timeout-minutes`.",
    check(ctx, emit) {
      for (const [jobId, job] of Object.entries(ctx.jobs)) {
        if (job["runs-on"] === undefined || job.uses !== undefined) continue;
        if (job["timeout-minutes"] === undefined)
          emit({
            rule: this.id,
            guideline: this.guideline,
            severity: this.severity,
            message: `Job \`${jobId}\` has no \`timeout-minutes\` (default is 360).`,
            line: ctx.src.jobLine(jobId),
          });
      }
    },
  },
  {
    id: "missing-concurrency",
    guideline: "GHA-21",
    severity: "info",
    description: "PR workflows should cancel superseded runs via `concurrency`.",
    check(ctx, emit) {
      if (!ctx.triggers.includes("pull_request")) return;
      if (ctx.wf.concurrency !== undefined) return;
      if (Object.values(ctx.jobs).some((j) => j.concurrency !== undefined)) return;
      emit({
        rule: this.id,
        guideline: this.guideline,
        severity: this.severity,
        message: "No `concurrency:` group; superseded PR runs keep running. Group on `${{ github.workflow }}-${{ github.ref }}`.",
        line: ctx.src.topKeyLine("on"),
      });
    },
  },
  {
    id: "fetch-depth-zero",
    guideline: "GHA-23",
    severity: "info",
    description: "Only fetch full history when the job needs it.",
    check(ctx, emit) {
      forEachStep(ctx, (jobId, _job, step, i) => {
        if (typeof step.uses !== "string" || actionName(step.uses) !== "actions/checkout") return;
        const w = isObj(step.with) ? step.with : {};
        if (w["fetch-depth"] === 0 || w["fetch-depth"] === "0")
          emit({
            rule: this.id,
            guideline: this.guideline,
            severity: this.severity,
            message: "`fetch-depth: 0` fetches the full history; keep it only if this job walks history or tags.",
            line: ctx.src.stepKeyLine(jobId, i, "fetch-depth"),
          });
      });
    },
  },
];

/** Composite / Docker action definitions (`action.yml`): only pinning applies. */
export function checkActionDefinition(src: YamlSource, emit: Emit) {
  const data = src.data as Obj | undefined;
  const runs = isObj(data?.runs) ? data.runs : undefined;
  if (!runs) return;
  if (typeof runs.image === "string" && runs.image.startsWith("docker://")) {
    const reason = unpinnedReason(runs.image);
    if (reason)
      emit({ rule: "unpinned-uses", guideline: "GHA-02", severity: "error", message: `Action image ${reason}.`, line: src.matchLine(/^\s*image\s*:/) });
  }
  if (!Array.isArray(runs.steps)) return;
  runs.steps.forEach((step: unknown, i: number) => {
    if (!isObj(step) || typeof step.uses !== "string") return;
    const reason = unpinnedReason(step.uses);
    if (reason)
      emit({ rule: "unpinned-uses", guideline: "GHA-02", severity: "error", message: `Action ${reason}.`, line: src.stepKeyLine(undefined, i, "uses") });
  });
}

export function workflowContext(src: YamlSource): WorkflowContext | undefined {
  if (!isObj(src.data)) return undefined;
  const wf = src.data;
  // YAML 1.1 parsers turn `on` into `true`; Bun.YAML keeps "on", but accept both.
  const on = wf.on ?? (wf as Record<string, unknown>)["true"];
  const jobs = isObj(wf.jobs) ? (wf.jobs as Record<string, Job>) : {};
  return { src, wf, jobs, triggers: triggersOf(on) };
}
