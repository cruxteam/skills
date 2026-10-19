import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "skills/crux-worktree/scripts/ticket-worktree.sh");
let sandbox: string;
let main: string;

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

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "ticket-worktree-"));
  git(sandbox, "init", "-q", "--bare", "-b", "main", "origin.git");
  git(sandbox, "clone", "-q", "origin.git", "main");
  main = join(sandbox, "main");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  git(main, "push", "-q", "origin", "HEAD:main");
  git(main, "remote", "set-head", "origin", "main");
  git(main, "push", "-q", "origin", "main:CR-13");
});
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

describe("ensure", () => {
  test("creates the ticket branch from the remote default branch and reuses it", () => {
    const first = script(main, "ensure", "CR-12");
    expect(first.code).toBe(0);
    expect(first.out).toEndWith("/.claude/worktrees/CR-12");
    expect(git(first.out, "branch", "--show-current")).toBe("CR-12");
    expect(script(main, "ensure", "CR-12").out).toBe(first.out);
    expect(git(main, "status", "--porcelain")).toBe("");
  });

  test("tracks a branch that exists only on the remote", () => {
    const { out } = script(main, "ensure", "CR-13");
    expect(git(out, "rev-parse", "--abbrev-ref", "@{u}")).toBe("origin/CR-13");
  });

  test("resolves the main checkout from inside another worktree", () => {
    const fromWorktree = script(join(main, ".claude/worktrees/CR-12"), "ensure", "CR-14");
    expect(fromWorktree.out).toEndWith("/main/.claude/worktrees/CR-14");
  });

  test("refuses a value that is not a ticket key", () => {
    expect(script(main, "ensure", "../x").code).toBe(1);
  });
});

describe("cleanup", () => {
  test("removes a clean claude/* launch worktree and its branch", () => {
    git(main, "worktree", "add", "-q", "-b", "claude/rnd", ".claude/worktrees/rnd", "main");
    expect(script(main, "cleanup", join(main, ".claude/worktrees/rnd")).code).toBe(0);
    expect(git(main, "branch", "--list", "claude/rnd")).toBe("");
  });

  test("refuses a ticket branch, a dirty tree and unpushed commits", () => {
    expect(script(main, "cleanup", join(main, ".claude/worktrees/CR-12")).err).toContain("not a claude/*");

    git(main, "worktree", "add", "-q", "-b", "claude/dirty", ".claude/worktrees/dirty", "main");
    writeFileSync(join(main, ".claude/worktrees/dirty/x"), "x");
    expect(script(main, "cleanup", join(main, ".claude/worktrees/dirty")).err).toContain("uncommitted");

    git(main, "worktree", "add", "-q", "-b", "claude/ahead", ".claude/worktrees/ahead", "main");
    git(join(main, ".claude/worktrees/ahead"), "commit", "-q", "--allow-empty", "-m", "local");
    expect(script(main, "cleanup", join(main, ".claude/worktrees/ahead")).err).toContain("no remote branch has");
  });

  test("refuses a path outside .claude/worktrees", () => {
    expect(script(main, "cleanup", sandbox).code).toBe(1);
  });
});
