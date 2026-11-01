import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRules } from "./rules/repo.ts";
import { workflowRules } from "./rules/workflow.ts";
import { guidelineDoc } from "./types.ts";

const ROOT = join(import.meta.dir, "..");
const ALL_RULES = [...workflowRules, ...repoRules];

/** Returns the markdown section for a guideline id (e.g. GHA-04) or a rule id (e.g. unpinned-uses). */
export function explain(idOrRule: string): string | undefined {
  let id = idOrRule.toUpperCase();
  if (!/^[A-Z]+-\d+$/.test(id)) {
    const rule = ALL_RULES.find((r) => r.id === idOrRule);
    if (!rule) return undefined;
    id = rule.guideline;
  }
  const doc = guidelineDoc(id);
  const text = readFileSync(join(ROOT, doc), "utf8");
  const lines = text.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^#{2,4}\\s+${id}:`).test(l));
  if (start === -1) return undefined;
  const level = lines[start]!.match(/^#+/)![0].length;
  let end = start + 1;
  while (end < lines.length && !(new RegExp(`^#{1,${level}}\\s`).test(lines[end]!) || lines[end] === "---")) end++;
  return `${lines.slice(start, end).join("\n").trim()}\n\n(${doc})`;
}

export function listRules(): string {
  return ALL_RULES.map((r) => `${r.guideline.padEnd(7)} ${r.id.padEnd(30)} ${r.severity.padEnd(8)} ${r.description}`).join("\n");
}
