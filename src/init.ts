import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { TEMPLATES_DIR } from "./rulesets.ts";

export interface InitOptions {
  target: string;
  ci?: boolean;
  release?: boolean;
  force?: boolean;
}

export interface InitResult {
  written: string[];
  skipped: string[];
}

const BASE = [".github/dependabot.yml", ".github/workflows/zizmor.yml"];

export function init(opts: InitOptions): InitResult {
  const files = [...BASE];
  if (opts.ci) files.push(".github/workflows/ci.yml");
  if (opts.release) files.push(".github/workflows/release.yml");

  const result: InitResult = { written: [], skipped: [] };
  for (const rel of files) {
    const dest = join(opts.target, rel);
    // Never clobber an existing dependabot.yaml / workflow either.
    const alt = rel.endsWith(".yml") ? dest.replace(/\.yml$/, ".yaml") : undefined;
    if (!opts.force && (existsSync(dest) || (alt && existsSync(alt)))) {
      result.skipped.push(rel);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(TEMPLATES_DIR, "repo", rel), dest);
    result.written.push(rel);
  }
  return result;
}
