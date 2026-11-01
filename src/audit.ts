import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { checkRepo } from "./rules/repo.ts";
import { checkActionDefinition, workflowContext, workflowRules } from "./rules/workflow.ts";
import { YamlSource } from "./source.ts";
import { SEVERITY_ORDER, type Finding } from "./types.ts";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "target", "vendor", ".venv"]);

export interface AuditResult {
  root: string;
  files: string[];
  findings: Finding[];
}

/** Audits one workflow file's text. `file` is used for reporting only. */
export function auditWorkflowText(file: string, text: string): Finding[] {
  const src = new YamlSource(file, text);
  if (src.parseError)
    return [{ rule: "parse-error", guideline: "GHA-09", severity: "error", file, message: `Could not parse YAML: ${src.parseError}` }];
  const ctx = workflowContext(src);
  if (!ctx) return [];
  const out: Finding[] = [];
  for (const rule of workflowRules) {
    rule.check(ctx, (f) => {
      if (!src.isSuppressed(f.rule, f.guideline, f.line)) out.push({ ...f, file });
    });
  }
  return out;
}

export function auditActionText(file: string, text: string): Finding[] {
  const src = new YamlSource(file, text);
  if (src.parseError) return [];
  const out: Finding[] = [];
  checkActionDefinition(src, (f) => {
    if (!src.isSuppressed(f.rule, f.guideline, f.line)) out.push({ ...f, file });
  });
  return out;
}

function findActionDefinitions(root: string, dir = root, depth = 0, out: string[] = []): string[] {
  if (depth > 6) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (e.name === "workflows" && basename(dir) === ".github") continue;
      findActionDefinitions(root, join(dir, e.name), depth + 1, out);
    } else if (e.name === "action.yml" || e.name === "action.yaml") {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

/** Audits a repository directory, or a single workflow file. */
export function audit(target: string): AuditResult {
  if (!existsSync(target)) throw new Error(`No such file or directory: ${target}`);

  if (statSync(target).isFile()) {
    const name = basename(target);
    if (!/\.ya?ml$/.test(name)) throw new Error(`Not a YAML workflow or action file: ${target}`);
    const text = readFileSync(target, "utf8");
    const findings = name === "action.yml" || name === "action.yaml" ? auditActionText(name, text) : auditWorkflowText(name, text);
    return { root: target, files: [name], findings: sortFindings(findings) };
  }

  const root = target;
  const wfDir = join(root, ".github", "workflows");
  const workflows = existsSync(wfDir)
    ? readdirSync(wfDir)
        .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
        .sort()
        .map((f) => join(".github", "workflows", f))
    : [];
  const workflowTexts = workflows.map((f) => readFileSync(join(root, f), "utf8"));

  const findings: Finding[] = [];
  workflows.forEach((f, i) => findings.push(...auditWorkflowText(f, workflowTexts[i]!)));

  const actions = findActionDefinitions(root).map((p) => relative(root, p));
  for (const f of actions) findings.push(...auditActionText(f, readFileSync(join(root, f), "utf8")));

  findings.push(...checkRepo({ root, workflows, workflowTexts }));

  return { root, files: [...workflows, ...actions], findings: sortFindings(findings) };
}

export function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}
