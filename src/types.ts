export type Severity = "error" | "warning" | "info";

export interface Finding {
  /** Machine-readable rule id, e.g. `unpinned-uses`. */
  rule: string;
  /** Guideline id the rule enforces, e.g. `GHA-02`. */
  guideline: string;
  severity: Severity;
  message: string;
  /** Path relative to the audited root. */
  file: string;
  /** 1-based line number, when known. */
  line?: number;
}

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Guideline id → document that defines it. */
export function guidelineDoc(id: string): string {
  const prefix = id.split("-")[0];
  switch (prefix) {
    case "GHA":
      return "guidelines/github-actions.md";
    case "REPO":
      return "guidelines/repository-and-org.md";
    case "REL":
      return "guidelines/releases.md";
    case "DEP":
      return "guidelines/dependencies.md";
    case "APP":
      return "guidelines/automation.md";
    default:
      return "guidelines/README.md";
  }
}
