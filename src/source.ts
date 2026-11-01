/**
 * A parsed YAML document plus a line-oriented locator.
 *
 * Bun.YAML gives us values but not positions, so findings are anchored with
 * indentation-aware text search. That is deliberately approximate: it only has
 * to point a human (or a `# oss-ignore:` comment) at the right spot.
 */
export class YamlSource {
  readonly lines: string[];
  readonly data: unknown;
  readonly parseError?: string;

  constructor(
    readonly file: string,
    readonly text: string,
  ) {
    this.lines = text.split(/\r?\n/);
    try {
      this.data = Bun.YAML.parse(text);
    } catch (err) {
      this.data = undefined;
      this.parseError = err instanceof Error ? err.message : String(err);
    }
  }

  /** 1-based line of a top-level key, e.g. `on:` or `permissions:`. */
  topKeyLine(key: string): number | undefined {
    const re = new RegExp(`^["']?${escape(key)}["']?\\s*:`);
    const idx = this.lines.findIndex((l) => re.test(l));
    return idx === -1 ? undefined : idx + 1;
  }

  /** [start, end) 0-based line range of `jobs.<id>`. */
  jobRange(jobId: string): [number, number] | undefined {
    const jobsIdx = this.lines.findIndex((l) => /^jobs\s*:/.test(l));
    if (jobsIdx === -1) return undefined;
    const re = new RegExp(`^(\\s+)["']?${escape(jobId)}["']?\\s*:\\s*(#.*)?$`);
    for (let i = jobsIdx + 1; i < this.lines.length; i++) {
      const m = re.exec(this.lines[i]!);
      if (!m) continue;
      const indent = m[1]!.length;
      let end = i + 1;
      for (; end < this.lines.length; end++) {
        const line = this.lines[end]!;
        if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
        if (leading(line) <= indent) break;
      }
      return [i, end];
    }
    return undefined;
  }

  jobLine(jobId: string): number | undefined {
    const r = this.jobRange(jobId);
    return r ? r[0] + 1 : undefined;
  }

  /** 0-based line indexes of each `- ` item under `jobs.<id>.steps` (or a composite action's `runs.steps`). */
  stepStarts(jobId?: string): number[] {
    let start = 0;
    let end = this.lines.length;
    if (jobId !== undefined) {
      const r = this.jobRange(jobId);
      if (!r) return [];
      [start, end] = r;
    }
    let stepsIdx = -1;
    for (let i = start; i < end; i++) {
      if (/^\s*steps\s*:/.test(this.lines[i]!)) {
        stepsIdx = i;
        break;
      }
    }
    if (stepsIdx === -1) return [];
    const stepsIndent = leading(this.lines[stepsIdx]!);
    let dashIndent = -1;
    const out: number[] = [];
    for (let i = stepsIdx + 1; i < end; i++) {
      const line = this.lines[i]!;
      if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
      const ind = leading(line);
      // The steps block ends at the first sibling key of `steps:`.
      if (ind <= stepsIndent && !line.trimStart().startsWith("-")) break;
      if (dashIndent === -1 && line.trimStart().startsWith("-")) dashIndent = ind;
      if (ind === dashIndent && line.trimStart().startsWith("-")) out.push(i);
      else if (dashIndent !== -1 && ind < dashIndent) break;
    }
    return out;
  }

  /** 1-based line of `key:` inside step `index` of a job, falling back to the step start. */
  stepKeyLine(jobId: string | undefined, index: number, key?: string): number | undefined {
    const starts = this.stepStarts(jobId);
    const s = starts[index];
    if (s === undefined) return jobId ? this.jobLine(jobId) : undefined;
    if (!key) return s + 1;
    const e = starts[index + 1] ?? (jobId ? this.jobRange(jobId)![1] : this.lines.length);
    const re = new RegExp(`(^|[\\s-])${escape(key)}\\s*:`);
    for (let i = s; i < e; i++) if (re.test(this.lines[i]!)) return i + 1;
    return s + 1;
  }

  /** 1-based line of the first line within a job that matches `re`. */
  jobMatchLine(jobId: string, re: RegExp): number | undefined {
    const r = this.jobRange(jobId);
    if (!r) return undefined;
    for (let i = r[0]; i < r[1]; i++) if (re.test(this.lines[i]!)) return i + 1;
    return r[0] + 1;
  }

  /** 1-based line of the first match anywhere in the file. */
  matchLine(re: RegExp): number | undefined {
    const idx = this.lines.findIndex((l) => re.test(l));
    return idx === -1 ? undefined : idx + 1;
  }

  /**
   * True when the finding is suppressed by `# oss-ignore: <rule|guideline>` on
   * the same line or the line above, or `# oss-ignore-file: <rule|guideline>`
   * anywhere in the file.
   */
  isSuppressed(rule: string, guideline: string, line?: number): boolean {
    const matches = (l: string, directive: string) => {
      const m = new RegExp(`#\\s*${directive}\\s*:\\s*([\\w\\-, ]+)`).exec(l);
      if (!m) return false;
      const ids = m[1]!.split(/[\s,]+/).filter(Boolean);
      return ids.includes(rule) || ids.includes(guideline);
    };
    if (this.lines.some((l) => matches(l, "oss-ignore-file"))) return true;
    if (line === undefined) return false;
    for (const n of [line, line - 1]) {
      const l = this.lines[n - 1];
      if (l !== undefined && matches(l, "oss-ignore")) return true;
    }
    return false;
  }
}

function leading(line: string): number {
  return line.length - line.trimStart().length;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
