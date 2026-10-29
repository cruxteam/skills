import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "skills/crux-config/scripts/config-branch.sh");
let sandbox: string;
let main: string;
let other: string;

const run = (cwd: string, ...args: string[]) => {
  const proc = Bun.spawnSync(args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  return { code: proc.exitCode, out: proc.stdout.toString().trim(), err: proc.stderr.toString().trim() };
};
const git = (cwd: string, ...args: string[]) => {
  const result = run(cwd, "git", "-c", "user.name=t", "-c", "user.email=t@t", ...args);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.err}`);
  return result.out;
};
const script = (cwd: string, ...args: string[]) => run(cwd, "sh", SCRIPT, ...args);
/** The folder the script printed; throws instead of handing an empty path (= this repo) to git. */
const folder = (cwd: string, ...args: string[]) => {
  const result = script(cwd, ...args);
  if (result.code !== 0 || result.out === "") throw new Error(`config-branch.sh failed: ${result.err}`);
  return result.out;
};
const commit = (cwd: string, message: string) => git(cwd, "commit", "-q", "--allow-empty", "-m", message);

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "config-branch-"));
  git(sandbox, "init", "-q", "--bare", "-b", "main", "origin.git");
  git(sandbox, "clone", "-q", "origin.git", "main");
  main = join(sandbox, "main");
  commit(main, "init");
  git(main, "push", "-q", "origin", "HEAD:main");
  git(main, "push", "-q", "origin", "HEAD:release");
  git(main, "remote", "set-head", "origin", "main");
  git(sandbox, "clone", "-q", "origin.git", "other");
  other = join(sandbox, "other");
});
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

describe("config-branch.sh", () => {
  test("creates crux-config/<KEY> from the bound branch in a worktree and reuses it", () => {
    const first = script(main, "KAN", "release");
    expect(first.code).toBe(0);
    expect(first.out).toEndWith("/.claude/worktrees/crux-config-KAN");
    expect(git(first.out, "branch", "--show-current")).toBe("crux-config/KAN");
    expect(git(first.out, "rev-parse", "HEAD")).toBe(git(main, "rev-parse", "origin/release"));
    expect(script(main, "KAN", "release").out).toBe(first.out);
    expect(git(main, "branch", "--show-current")).toBe("main");
    expect(git(main, "status", "--porcelain")).toBe("");
  });

  test("starts from the remote's default branch when no bound branch is given", () => {
    const { code, out } = script(main, "DEF");
    expect(code).toBe(0);
    expect(git(out, "rev-parse", "HEAD")).toBe(git(main, "rev-parse", "origin/main"));
  });

  test("uses the checkout itself when it is already on the config branch", () => {
    git(other, "switch", "-q", "-c", "crux-config/OWN", "origin/main");
    writeFileSync(join(other, "draft.txt"), "a stage written before an interruption");
    const { code, out } = script(other, "OWN", "main");
    expect(code).toBe(0);
    expect(out).toBe(git(other, "rev-parse", "--show-toplevel"));
  });

  test("fast-forwards to the remote config branch another teammate pushed", () => {
    const out = folder(main, "PUSH", "main");
    git(out, "push", "-q", "-u", "origin", "crux-config/PUSH");
    git(other, "fetch", "-q");
    git(other, "switch", "-q", "-c", "theirs", "origin/crux-config/PUSH");
    commit(other, "teammate's stage");
    git(other, "push", "-q", "origin", "theirs:crux-config/PUSH");
    expect(script(main, "PUSH", "main").code).toBe(0);
    expect(git(out, "log", "-1", "--format=%s")).toBe("teammate's stage");
  });

  test("moves to the bound branch once the last config PR merged", () => {
    const out = folder(main, "MRG", "main");
    commit(out, "config");
    git(out, "push", "-q", "-u", "origin", "crux-config/MRG");
    git(main, "fetch", "-q");
    git(main, "merge", "-q", "--ff-only", "origin/crux-config/MRG");
    commit(main, "later work on main");
    git(main, "push", "-q", "origin", "HEAD:main");
    expect(script(main, "MRG", "main").code).toBe(0);
    expect(git(out, "rev-parse", "HEAD")).toBe(git(main, "rev-parse", "origin/main"));
  });

  test("refuses a branch that diverged from its remote instead of forcing either side", () => {
    const out = folder(main, "DIV", "main");
    git(out, "push", "-q", "-u", "origin", "crux-config/DIV");
    commit(out, "local");
    git(other, "fetch", "-q");
    git(other, "switch", "-q", "-c", "div", "origin/crux-config/DIV");
    commit(other, "remote");
    git(other, "push", "-q", "origin", "div:crux-config/DIV");
    const result = script(main, "DIV", "main");
    expect(result.code).toBe(1);
    expect(result.err).toContain("diverged");
  });

  test("refuses a bad key, an unknown bound branch and a missing argument", () => {
    expect(script(main, "../x", "main").code).toBe(1);
    expect(script(main, "KAN", "no-such-branch").err).toContain("no-such-branch");
    expect(script(main).code).toBe(1);
  });

  test("never forces a push or a reset", () => {
    expect(readFileSync(SCRIPT, "utf8")).not.toMatch(/--force|push -f|reset --hard/);
  });
});
