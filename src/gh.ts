/**
 * Minimal GitHub REST client on top of the `gh` CLI, so we reuse the user's
 * existing authentication and never handle tokens ourselves.
 */
export interface ApiResponse<T = unknown> {
  status: number;
  data: T | null;
}

export type Api = <T = unknown>(path: string, init?: { method?: string; body?: unknown }) => Promise<ApiResponse<T>>;

export const ghApi: Api = async <T>(path: string, init: { method?: string; body?: unknown } = {}) => {
  const args = ["gh", "api", "--include", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28"];
  if (init.method) args.push("--method", init.method);
  if (init.body !== undefined) args.push("--input", "-");
  args.push(path);

  let proc;
  try {
    proc = Bun.spawn(args, {
      stdin: init.body !== undefined ? new Blob([JSON.stringify(init.body)]) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    throw new Error("The GitHub CLI (`gh`) is required. Install it and run `gh auth login`.");
  }
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;

  const m = /^HTTP\/[\d.]+\s+(\d{3})/.exec(out);
  if (!m) throw new Error(`gh api ${path} failed: ${err.trim() || out.trim() || "no output"}`);
  const status = Number(m[1]);
  const sep = out.search(/\r?\n\r?\n/);
  const body = sep === -1 ? "" : out.slice(sep).trim();
  let data: T | null = null;
  if (body) {
    try {
      data = JSON.parse(body) as T;
    } catch {
      data = null;
    }
  }
  return { status, data };
};

export function parseRepo(slug: string): { owner: string; repo: string } {
  const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(slug.trim());
  if (!m) throw new Error(`Expected owner/repo, got "${slug}"`);
  return { owner: m[1]!, repo: m[2]! };
}
