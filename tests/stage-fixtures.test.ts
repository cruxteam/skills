import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CRITIC_CASES } from "./harness/critic-cases";

const ROOT = join(import.meta.dir, "..");
const GENERIC = join(import.meta.dir, "fixtures/generic/.crux");
const VALIDATOR = join(ROOT, "skills/crux-config/scripts/validate.mjs");
const json = (rel: string) => JSON.parse(readFileSync(join(import.meta.dir, "fixtures", rel), "utf8"));
const CONTEXTS = {
  jira: "tools/new-project/config_context.json",
  plane: "tools/plane/config_context.json",
  linear: "tools/linear/config_context.json",
  github: "tools/github/config_context.json",
};

/** Every file of a `.crux/` folder, as `{path: text}` (symlinks by their target). */
const tree = (dir: string, prefix = ""): Record<string, string> =>
  Object.fromEntries(
    readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return Object.entries(tree(dir, rel));
      return [[rel, entry.isSymbolicLink() ? "link" : readFileSync(join(dir, rel), "utf8")]];
    }),
  );

describe("tracker contexts", () => {
  for (const [kind, rel] of Object.entries(CONTEXTS)) {
    test(`${kind} has the config_context fields the stages read`, () => {
      const context = json(rel);
      expect(context.tracker.kind).toBe(kind);
      for (const key of ["statuses", "issueTypes", "sprints", "estimateScale"]) expect(key in context.tracker).toBe(true);
      expect(typeof context.project.key).toBe("string");
      expect("chatRetentionMax" in context.project).toBe(true);
      expect(Array.isArray(context.llmProviders)).toBe(true);
    });
  }

  test("GitHub without a Project has no statuses and no provider key", () => {
    expect(json(CONTEXTS.github).tracker.statuses).toBeNull();
    expect(json(CONTEXTS.github).llmProviders).toEqual([]);
  });

  test("Plane has a wiki bound and no native scale; Linear has a native scale", () => {
    expect(json(CONTEXTS.plane).repos.wiki).toBeDefined();
    expect(json(CONTEXTS.plane).tracker.estimateScale.native).toBeUndefined();
    expect(json(CONTEXTS.linear).tracker.estimateScale.native).toEqual([0, 1, 2, 3, 5, 8]);
  });

  test("the recorded skills find output lists installable sources", () => {
    const text = readFileSync(join(import.meta.dir, "fixtures/tools/skills-find.txt"), "utf8");
    expect(text).not.toContain("\x1b[");
    expect(text.match(/^[\w.-]+\/[\w.-]+@[\w.-]+ /gm)?.length).toBeGreaterThan(20);
  });
});

describe("critic cases", () => {
  const checks = CRITIC_CASES.map((c) => c.check);

  test("seed one violation of every principle and every check", () => {
    for (let n = 1; n <= 12; n++) expect(checks).toContain(`principle-${n}`);
    for (const check of ["dangling-reference", "advisor-compat", "least-privilege", "write-tools", "artifact", "quoted-data"]) {
      expect(checks).toContain(check);
    }
    expect(new Set(CRITIC_CASES.map((c) => c.id)).size).toBe(CRITIC_CASES.length);
  });

  for (const c of CRITIC_CASES) {
    test(`${c.id} changes the generic package at ${c.path} and keeps it free of validator errors`, () => {
      const crux = join(mkdtempSync(join(tmpdir(), "critic-case-")), ".crux");
      cpSync(GENERIC, crux, { recursive: true, verbatimSymlinks: true });
      c.mutate(crux);
      const after = tree(crux);
      const before = tree(GENERIC);
      expect(after).not.toEqual(before);
      expect(Object.keys(after).some((p) => p === c.path || p.startsWith(`${c.path}/`))).toBe(true);
      const proc = Bun.spawnSync(["bun", VALIDATOR, "--json", crux]);
      const { issues } = JSON.parse(proc.stdout.toString()) as { issues: { severity: string; message: string }[] };
      expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    });
  }
});
