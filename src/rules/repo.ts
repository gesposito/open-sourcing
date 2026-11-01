import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { YamlSource } from "../source.ts";
import type { Finding } from "../types.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const RENOVATE_FILES = [
  "renovate.json",
  "renovate.json5",
  ".github/renovate.json",
  ".github/renovate.json5",
  ".gitlab/renovate.json",
  ".renovaterc",
  ".renovaterc.json",
  ".renovaterc.json5",
];

/** Rules implemented by `checkRepo`, for `oss rules` / `oss explain`. */
export const repoRules = [
  { id: "no-update-automation", guideline: "DEP-01", severity: "warning", description: "Repository must have Dependabot or Renovate configured." },
  { id: "dependabot-no-actions", guideline: "DEP-01", severity: "warning", description: "Dependabot must update the github-actions ecosystem." },
  { id: "dependabot-no-cooldown", guideline: "DEP-02", severity: "warning", description: "Every Dependabot updates entry needs a cooldown." },
  { id: "renovate-no-cooldown", guideline: "DEP-02", severity: "warning", description: "Renovate config needs minimumReleaseAge." },
  { id: "zizmor-not-in-ci", guideline: "GHA-09", severity: "warning", description: "Some workflow must run zizmor." },
] as const;

export interface RepoFacts {
  root: string;
  /** Workflow file paths relative to root. */
  workflows: string[];
  /** Raw workflow texts, same order as `workflows`. */
  workflowTexts: string[];
}

/** Repository-level checks that span files: update automation, cooldowns, zizmor in CI. */
export function checkRepo(facts: RepoFacts): Finding[] {
  const out: Finding[] = [];
  const { root } = facts;

  const depFile = [".github/dependabot.yml", ".github/dependabot.yaml"].find((f) => existsSync(join(root, f)));
  const renovateFile = RENOVATE_FILES.find((f) => existsSync(join(root, f)));
  let renovateInPkg = false;
  if (!renovateFile && existsSync(join(root, "package.json"))) {
    try {
      renovateInPkg = isObj(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).renovate);
    } catch {
      /* not our problem here */
    }
  }

  if (!depFile && !renovateFile && !renovateInPkg) {
    out.push({
      rule: "no-update-automation",
      guideline: "DEP-01",
      severity: "warning",
      file: ".github/dependabot.yml",
      message: "No Dependabot or Renovate configuration. Run `oss init` to add a Dependabot config with cooldowns.",
    });
  }

  if (depFile) {
    const src = new YamlSource(depFile, readFileSync(join(root, depFile), "utf8"));
    const updates = isObj(src.data) && Array.isArray(src.data.updates) ? (src.data.updates as unknown[]) : [];
    let sawActions = false;
    updates.forEach((u, i) => {
      if (!isObj(u)) return;
      const eco = String(u["package-ecosystem"] ?? "?");
      if (eco === "github-actions") sawActions = true;
      if (!isObj(u.cooldown)) {
        const line = nthMatchLine(src, /^\s*-\s*package-ecosystem\s*:/, i);
        if (!src.isSuppressed("dependabot-no-cooldown", "DEP-02", line))
          out.push({
            rule: "dependabot-no-cooldown",
            guideline: "DEP-02",
            severity: "warning",
            file: depFile,
            line,
            message: `Dependabot \`${eco}\` updates have no \`cooldown:\`; add \`cooldown: { default-days: 7 }\`.`,
          });
      }
    });
    if (!sawActions && facts.workflows.length > 0 && !renovateFile && !renovateInPkg)
      out.push({
        rule: "dependabot-no-actions",
        guideline: "DEP-01",
        severity: "warning",
        file: depFile,
        message: "Dependabot doesn't update `github-actions`, so SHA pins will go stale.",
      });
  }

  const renovatePath = renovateFile ?? (renovateInPkg ? "package.json" : undefined);
  if (renovatePath) {
    const text = readFileSync(join(root, renovatePath), "utf8");
    if (!/minimumReleaseAge/.test(text))
      out.push({
        rule: "renovate-no-cooldown",
        guideline: "DEP-02",
        severity: "warning",
        file: renovatePath,
        message: 'Renovate config has no `minimumReleaseAge`; add `"minimumReleaseAge": "7 days"`.',
      });
  }

  if (facts.workflows.length > 0 && !facts.workflowTexts.some((t) => /zizmor/i.test(t)))
    out.push({
      rule: "zizmor-not-in-ci",
      guideline: "GHA-09",
      severity: "warning",
      file: ".github/workflows",
      message: "No workflow runs zizmor. Run `oss init` to add the pinned zizmor workflow.",
    });

  return out;
}

function nthMatchLine(src: YamlSource, re: RegExp, n: number): number | undefined {
  let seen = 0;
  for (let i = 0; i < src.lines.length; i++) {
    if (re.test(src.lines[i]!)) {
      if (seen === n) return i + 1;
      seen++;
    }
  }
  return undefined;
}
