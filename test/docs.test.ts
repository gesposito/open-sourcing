import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DOCS = ["README.md", "CLAUDE.md", ...["guidelines", "references", "checklists", "templates/rulesets"].flatMap((d) =>
  readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".md")).map((f) => `${d}/${f}`),
)];

/** GitHub's heading → anchor slug. */
const slug = (h: string) =>
  h.trim().toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");

const anchorsOf = (file: string) =>
  new Set(readFileSync(file, "utf8").split("\n").filter((l) => /^#{1,6}\s/.test(l)).map((l) => slug(l.replace(/^#+\s*/, ""))));

describe("docs", () => {
  test.each(DOCS)("relative links and anchors resolve in %s", (doc) => {
    const text = readFileSync(join(ROOT, doc), "utf8").replace(/```[\s\S]*?```/g, "");
    const links = [...text.matchAll(/\]\(([^)\s]+)\)|^\[[^\]]+\]:\s*(\S+)/gm)].map((m) => m[1] ?? m[2]!);
    for (const link of links) {
      if (/^(https?:|mailto:)/.test(link)) continue;
      const [path, anchor] = link.split("#");
      const target = path ? resolve(dirname(join(ROOT, doc)), path) : join(ROOT, doc);
      expect(existsSync(target) ? link : `${doc}: missing ${link}`).toBe(link);
      if (anchor && target.endsWith(".md")) expect(anchorsOf(target).has(anchor) ? link : `${doc}: bad anchor ${link}`).toBe(link);
    }
  });

  test("every guideline id is defined exactly once", () => {
    const ids = DOCS.filter((d) => d.startsWith("guidelines/")).flatMap((d) =>
      [...readFileSync(join(ROOT, d), "utf8").matchAll(/^###\s+([A-Z]+-\d+):/gm)].map((m) => m[1]!),
    );
    expect(ids.length).toBeGreaterThan(30);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
