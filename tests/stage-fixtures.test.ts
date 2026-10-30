import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKS, CRITIC_CASES } from "./harness/critic-cases";
import { CONTEXTS, validatePackage } from "./harness/stage-lib";

const GENERIC = join(import.meta.dir, "fixtures/generic/.crux");
const context = (kind: keyof typeof CONTEXTS) =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures/tools", CONTEXTS[kind], "config_context.json"), "utf8"));

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
  for (const kind of Object.keys(CONTEXTS) as (keyof typeof CONTEXTS)[]) {
    test(`${kind} has the config_context fields the stages read`, () => {
      const ctx = context(kind);
      expect(ctx.tracker.kind).toBe(kind);
      for (const key of ["statuses", "issueTypes", "sprints", "estimateScale"]) expect(key in ctx.tracker).toBe(true);
      expect(typeof ctx.project.key).toBe("string");
      expect("chatRetentionMax" in ctx.project).toBe(true);
      expect(Array.isArray(ctx.llmProviders)).toBe(true);
    });
  }

  test("GitHub without a Project has no statuses and no provider key", () => {
    expect(context("github").tracker.statuses).toBeNull();
    expect(context("github").llmProviders).toEqual([]);
  });

  test("Plane has a wiki bound and no native scale; Linear has a native scale", () => {
    expect(context("plane").repos.wiki).toBeDefined();
    expect(context("plane").tracker.estimateScale.native).toBeUndefined();
    expect(context("linear").tracker.estimateScale.native).toEqual([0, 1, 2, 3, 5, 8]);
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
    for (const check of CHECKS) expect(checks).toContain(check);
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
      const { issues } = validatePackage(crux);
      expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    });
  }
});
