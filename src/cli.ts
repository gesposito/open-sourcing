#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { audit } from "./audit.ts";
import { explain, listRules } from "./explain.ts";
import { ghApi, parseRepo } from "./gh.ts";
import { init } from "./init.ts";
import { formatChecks, repoCheck } from "./repo-check.ts";
import { color, formatFindings, type Format } from "./report.ts";
import { applyPlan, planRulesets, RELEASE_GATE, renderRulesets, type Scope } from "./rulesets.ts";
import type { Finding } from "./types.ts";

const HELP = `oss: open-sourcing guidelines toolkit

Usage:
  oss audit [paths...] [--format text|json|github] [--strict] [--min-severity error|warning|info]
      Statically check workflows, action definitions, and update configs against the
      guidelines. Defaults to the current directory. Exits 1 on errors (and on
      warnings with --strict).

  oss repo-check <owner/repo> [--environment release] [--json]
      Read-only check of live GitHub settings (rulesets, environments, Actions
      policy, immutable releases, secrets). Uses your \`gh\` authentication.

  oss rulesets (--repo <owner/repo> | --org <org> [--repos a,b])
               [--release-gate] [--environment release] [--apply] [--json]
      Render the baseline rulesets (templates/rulesets). Dry run by default;
      --apply creates or updates them via the API.

  oss init [dir] [--ci] [--release] [--force]
      Add dependabot.yml (with cooldown) and a pinned zizmor workflow. --ci adds a
      hardened CI skeleton, --release the gated release workflow. Never overwrites
      unless --force.

  oss explain <GUIDELINE-ID | rule-id>    Print a guideline, e.g. \`oss explain GHA-04\`.
  oss rules                               List the automated checks.
`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "audit":
      return cmdAudit(rest);
    case "repo-check":
      return cmdRepoCheck(rest);
    case "rulesets":
      return cmdRulesets(rest);
    case "init":
      return cmdInit(rest);
    case "explain": {
      const id = rest[0];
      if (!id) return usage("explain needs an id, e.g. `oss explain GHA-04`");
      const text = explain(id);
      if (!text) return usage(`Unknown guideline or rule: ${id}`);
      console.log(text);
      return 0;
    }
    case "rules":
      console.log(listRules());
      return 0;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
    default:
      return usage(`Unknown command: ${cmd}`);
  }
}

function usage(msg: string): number {
  console.error(`${color.red("error:")} ${msg}\n`);
  console.error(HELP);
  return 2;
}

function cmdAudit(args: string[]): number {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      format: { type: "string", default: "text" },
      strict: { type: "boolean", default: false },
      "min-severity": { type: "string", default: "info" },
    },
  });
  const format = values.format as Format;
  if (!["text", "json", "github"].includes(format)) return usage(`Unknown format: ${format}`);
  const order = { error: 0, warning: 1, info: 2 } as const;
  const min = values["min-severity"] as keyof typeof order;
  if (!(min in order)) return usage(`Unknown severity: ${min}`);

  const targets = positionals.length ? positionals : ["."];
  const all: Finding[] = [];
  let files = 0;
  for (const t of targets) {
    const r = audit(t);
    files += r.files.length;
    const prefix = targets.length > 1 ? `${t.replace(/\/$/, "")}/` : "";
    all.push(...r.findings.map((f) => ({ ...f, file: prefix + f.file })));
  }
  const shown = all.filter((f) => order[f.severity] <= order[min]);
  console.log(formatFindings(shown, format, files));
  const failing = all.filter((f) => f.severity === "error" || (values.strict && f.severity === "warning"));
  return failing.length ? 1 : 0;
}

async function cmdRepoCheck(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { environment: { type: "string", default: "release" }, json: { type: "boolean", default: false } },
  });
  if (!positionals[0]) return usage("repo-check needs <owner/repo>");
  const { owner, repo } = parseRepo(positionals[0]);
  const results = await repoCheck(ghApi, { owner, repo, environment: values.environment });
  console.log(values.json ? JSON.stringify(results, null, 2) : formatChecks(`${owner}/${repo}`, results));
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

async function cmdRulesets(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      org: { type: "string" },
      repos: { type: "string" },
      "release-gate": { type: "boolean", default: false },
      environment: { type: "string", default: "release" },
      apply: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  if (!values.repo === !values.org) return usage("rulesets needs exactly one of --repo <owner/repo> or --org <org>");
  const scope: Scope = values.repo
    ? { kind: "repo", ...parseRepo(values.repo) }
    : { kind: "org", org: values.org!, repos: values.repos?.split(",").map((s) => s.trim()).filter(Boolean) };
  const payloads = renderRulesets({ scope, releaseGate: values["release-gate"], environment: values.environment });

  if (values.json && !values.apply) {
    console.log(JSON.stringify(payloads, null, 2));
    return 0;
  }

  const where = scope.kind === "org" ? `org ${scope.org}${scope.repos ? ` (repos: ${scope.repos.join(", ")})` : " (all repos)"}` : `${scope.owner}/${scope.repo}`;
  let plan;
  try {
    plan = await planRulesets(ghApi, scope, payloads);
  } catch (err) {
    console.error(`${color.yellow("!")} ${(err as Error).message}`);
    console.error("Showing the rulesets that would be applied instead (use --json for full payloads):");
    for (const p of payloads) console.log(`  • ${p.name} (${p.target}): ${p.rules.map((r) => r.type).join(", ")}`);
    return values.apply ? 1 : 0;
  }

  console.log(color.bold(`Rulesets for ${where}${values.apply ? "" : " (dry run)"}`));
  const verb = { create: color.green("+ create"), update: color.yellow("~ update"), skip: color.dim("= skip  ") };
  for (const item of plan) {
    const detail = item.action === "skip" ? color.dim("already enforced by an org ruleset") : `${item.payload.target}: ${item.payload.rules.map((r) => r.type).join(", ")}`;
    console.log(`  ${verb[item.action]} ${item.payload.name} (${detail})`);
  }
  if (!values["release-gate"]) console.log(color.dim(`  (${RELEASE_GATE} skipped; add --release-gate once your release workflow creates tags after deploying to \`${values.environment}\`, see REL-06)`));
  if (scope.kind === "repo") console.log(color.dim("  Repo-level rulesets can be edited by repo admins; prefer --org where possible (REPO-06)."));

  if (!values.apply) {
    console.log(`\nRe-run with ${color.bold("--apply")} to make these changes.`);
    return 0;
  }
  const log = await applyPlan(ghApi, scope, plan);
  console.log("\n" + log.join("\n"));
  return log.some((l) => l.includes("failed")) ? 1 : 0;
}

function cmdInit(args: string[]): number {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { ci: { type: "boolean", default: false }, release: { type: "boolean", default: false }, force: { type: "boolean", default: false } },
  });
  const target = positionals[0] ?? ".";
  const r = init({ target, ci: values.ci, release: values.release, force: values.force });
  for (const f of r.written) console.log(`${color.green("+")} ${f}`);
  for (const f of r.skipped) console.log(`${color.dim("=")} ${f} ${color.dim("(exists; use --force to overwrite)")}`);
  console.log(
    "\nNext steps:\n" +
      "  1. Add a Dependabot entry (with cooldown) for each package ecosystem in the repo.\n" +
      (values.release ? "  2. Adapt release.yml to your registry and configure Trusted Publishing (REL-01).\n" : "") +
      `  ${values.release ? 3 : 2}. Run \`oss audit ${target}\` and \`oss repo-check <owner/repo>\`.`,
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`${color.red("error:")} ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  },
);
