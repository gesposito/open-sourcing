import { guidelineDoc, type Finding, type Severity } from "./types.ts";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const color = {
  red: (s: string) => c("31", s),
  yellow: (s: string) => c("33", s),
  blue: (s: string) => c("34", s),
  green: (s: string) => c("32", s),
  dim: (s: string) => c("2", s),
  bold: (s: string) => c("1", s),
};

const LABEL: Record<Severity, string> = {
  error: color.red("error"),
  warning: color.yellow("warning"),
  info: color.blue("info"),
};

export type Format = "text" | "json" | "github";

export function formatFindings(findings: Finding[], format: Format, filesScanned: number): string {
  if (format === "json") return JSON.stringify(findings, null, 2);

  if (format === "github") {
    const level: Record<Severity, string> = { error: "error", warning: "warning", info: "notice" };
    return findings
      .map((f) => {
        const loc = `file=${f.file}${f.line ? `,line=${f.line}` : ""}`;
        const title = `${f.guideline} ${f.rule}`;
        return `::${level[f.severity]} ${loc},title=${title}::${f.message.replace(/\n/g, "%0A")}`;
      })
      .join("\n");
  }

  if (findings.length === 0) return color.green(`✓ No findings in ${filesScanned} file(s).`);

  const lines: string[] = [];
  let current = "";
  for (const f of findings) {
    if (f.file !== current) {
      current = f.file;
      lines.push("", color.bold(f.file));
    }
    const loc = f.line ? color.dim(`:${f.line}`.padEnd(6)) : "      ";
    lines.push(`  ${loc} ${LABEL[f.severity]} ${color.dim(`[${f.guideline} ${f.rule}]`)} ${f.message}`);
  }
  const count = (s: Severity) => findings.filter((f) => f.severity === s).length;
  const guidelines = [...new Set(findings.map((f) => guidelineDoc(f.guideline)))].sort();
  lines.push(
    "",
    `${count("error")} error(s), ${count("warning")} warning(s), ${count("info")} info in ${filesScanned} file(s).`,
    color.dim(`See: ${guidelines.join(", ")} · run \`oss explain <ID>\` for details · suppress with \`# oss-ignore: <rule>\``),
  );
  return lines.join("\n").replace(/^\n/, "");
}
