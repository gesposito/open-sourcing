/**
 * Fixtures are materialized into temp dirs at test time rather than committed as
 * YAML, so zizmor and `oss audit` never see the intentionally-bad files in this repo.
 */
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function materialize(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "oss-fixture-"));
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
  return dir;
}

/** A copy of templates/repo: must audit clean. */
export function goodRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "oss-fixture-"));
  cpSync(join(import.meta.dir, "..", "templates", "repo"), dir, { recursive: true });
  return dir;
}

/** Violates every rule; line numbers are asserted in tests. */
export const BAD_WORKFLOW = `name: bad
on:
  pull_request:
  pull_request_target:
  workflow_run:
    workflows: [ci]
    types: [completed]

permissions:
  contents: write
  id-token: write

env:
  API_KEY: \${{ secrets.API_KEY }}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@3d3c42e5aac5ba805825da76410c181273ba90b1
      - run: echo "\${{ secrets.DEPLOY_KEY }}"
      - run: echo '\${{ toJSON(secrets) }}'
      - uses: zizmorcore/zizmor-action@53290badfa369cb0bf7ad16342cb62c2fa47ac7b # v0.8.0
      - uses: some/tool@3d3c42e5aac5ba805825da76410c181273ba90b1 # v1
        with:
          version: latest

  publish:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment: release
    permissions: write-all
    env:
      NPM_TOKEN: \${{ secrets.NPM_TOKEN }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/cache@main
        with:
          path: ~/.npm
          key: npm
      - uses: astral-sh/setup-uv@20cfd1bf945f4377ade1205e4dbc17946fc9a30d # v10.0.1
      - uses: docker://alpine:3

  call:
    uses: org/repo/.github/workflows/x.yml@main
    secrets: inherit
`;

export const BAD_ACTION = `name: setup
runs:
  using: composite
  steps:
    - uses: actions/setup-python@v6
    - run: echo hi
      shell: bash
`;

export const BAD_DEPENDABOT = `version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
`;

export function badRepo(): string {
  return materialize({
    ".github/workflows/bad.yml": BAD_WORKFLOW,
    ".github/actions/setup/action.yml": BAD_ACTION,
    ".github/dependabot.yml": BAD_DEPENDABOT,
  });
}
