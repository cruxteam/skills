import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const json = (rel: string) => JSON.parse(read(rel));

const SKILLS = readdirSync(join(ROOT, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const frontmatter = (skill: string) => {
  const match = read(`skills/${skill}/SKILL.md`).match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${skill}/SKILL.md has no frontmatter`);
  return Object.fromEntries(
    match[1].split("\n").map((line) => {
      const at = line.indexOf(":");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^"|"$/g, "")];
    }),
  );
};

/** The bootstrap a new session starts from: the blockquote that opens with "You are dispatched". */
const bootstrap = (skill: string) => {
  const lines = read(`skills/${skill}/SKILL.md`).split("\n");
  const start = lines.findIndex((line) => line.trim().startsWith("> You are dispatched"));
  const quote: string[] = [];
  for (const line of lines.slice(start)) {
    if (!line.trim().startsWith(">")) break;
    quote.push(line.trim().replace(/^>\s?/, ""));
  }
  return quote.join(" ");
};

describe("plugin layout", () => {
  test("ships the five crux skills in a flat skills/ directory", () => {
    expect(SKILLS).toEqual(["crux-config", "crux-dispatch", "crux-retro", "crux-run", "crux-worktree"]);
  });

  test("every manifest names the crux plugin at one version", () => {
    const plugin = json(".claude-plugin/plugin.json");
    expect(plugin.name).toBe("crux");
    expect(json(".claude-plugin/marketplace.json").plugins.map((p: { name: string }) => p.name)).toEqual(["crux"]);
    expect(json("gemini-extension.json")).toMatchObject({ name: "crux", version: plugin.version });
    expect(json("package.json").version).toBe(plugin.version);
    expect(read("CHANGELOG.md")).toContain(`## ${plugin.version} `);
  });

  for (const skill of SKILLS) {
    test(`${skill} has a matching name, a description and Codex metadata`, () => {
      const meta = frontmatter(skill);
      expect(meta.name).toBe(skill);
      expect(meta.description.length).toBeGreaterThan(40);
      expect(read(`skills/${skill}/agents/openai.yaml`)).toContain("display_name:");
    });

    test(`${skill} points only at files that exist`, () => {
      const text = read(`skills/${skill}/SKILL.md`);
      for (const [, rel] of text.matchAll(/<this skill's directory>\/([\w./-]+)/g)) {
        expect(existsSync(resolve(ROOT, "skills", skill, rel))).toBe(true);
      }
    });
  }
});

/** The errors a tool answers when it reads the tracker under the caller's linked identity. */
const TRACKER_ERRORS = [
  "TRACKER_IDENTITY_REQUIRED",
  "TRACKER_AUTH",
  "upstream_auth",
  "TRACKER_UNAVAILABLE",
  "upstream_unavailable",
];

describe("session-starting skills", () => {
  for (const skill of ["crux-dispatch", "crux-run"]) {
    test(`${skill} names the tracker claim errors and their reasons`, () => {
      const text = read(`skills/${skill}/SKILL.md`);
      for (const code of TRACKER_ERRORS) {
        expect(text).toContain(code);
      }
    });
  }

  test("crux-dispatch and crux-run start sessions from the same bootstrap", () => {
    expect(bootstrap("crux-dispatch")).toBe(bootstrap("crux-run"));
    expect(bootstrap("crux-run")).toContain("retry it as-is up to 3 attempts in total");
  });

  test("the bootstrap fits inside single quotes in a shell command", () => {
    expect(bootstrap("crux-run")).not.toContain("'");
  });
});

describe("crux-retro", () => {
  const text = () => read("skills/crux-retro/SKILL.md");
  /** The body of the `## <n>.` section, up to the next `## ` heading. */
  const section = (n: number) => {
    const body = text().split(`\n## ${n}. `)[1];
    if (!body) throw new Error(`crux-retro/SKILL.md has no section ${n}`);
    return body.split("\n## ")[0];
  };

  test("names every error code and reason it handles", () => {
    for (const code of [
      "sprint_ambiguous",
      "sprint_has_no_end",
      "sprint_not_found",
      "CONFLICT",
      "NOT_FOUND",
      "INVALID_INPUT",
      "invalid_cursor",
      "level_not_found",
      "UNSUPPORTED_BY_TRACKER",
      "direction_missing",
      "perf_run_not_found",
      ...TRACKER_ERRORS,
    ]) {
      expect(text()).toContain(code);
    }
  });

  test("calls the retro tools and pages through nextCursor", () => {
    for (const tool of ["retro_context", "perf_submit", "ticket_level_list", "ticket_create", "retro_save"]) {
      expect(text()).toContain(tool);
    }
    expect(section(1)).toContain("nextCursor");
  });

  test("picks mainline commits from the resolved remote ref", () => {
    expect(section(3)).toContain("--first-parent");
    expect(section(3)).not.toContain("origin/<branch>");
    expect(section(3)).toContain("`period.startsAt` is null");
  });

  test("places benchmark worktrees in the main checkout and detects the end of a run", () => {
    expect(section(3)).toContain("--git-common-dir");
    expect(section(3)).toContain("info/exclude");
    expect(section(3)).toContain("<log>.done");
  });

  test("checks the level and creates tickets only after an explicit ok", () => {
    for (const word of ['explicit "ok"', "ticket_level_list", "ticket_create", "level_not_found"]) {
      expect(section(5)).toContain(word);
    }
    expect(section(5)).not.toContain("BACKLOG");
  });
});

describe("crux-config", () => {
  const SKILL = "skills/crux-config";
  const text = () => read(`${SKILL}/SKILL.md`);
  /** The body of the `## <n>.` section, up to the next `## ` heading. */
  const section = (n: number) => {
    const body = text().split(`\n## ${n}. `)[1];
    if (!body) throw new Error(`crux-config/SKILL.md has no section ${n}`);
    return body.split("\n## ")[0];
  };
  /** A recorded answer of a crux MCP tool (tests/fixtures/tools/<scenario>/<tool>.json). */
  const recorded = (scenario: string, tool: string) => json(`tests/fixtures/tools/${scenario}/${tool}.json`);
  const at = (value: unknown, path: string) =>
    path.split(".").reduce<unknown>((v, key) => (v as Record<string, unknown> | null)?.[key], value);

  test("is started only by the person, with the stage and edit arguments", () => {
    const meta = frontmatter("crux-config");
    expect(meta["disable-model-invocation"]).toBe("true");
    expect(meta["argument-hint"]).toContain("edit <agent|flow|level>");
    expect(read(`${SKILL}/agents/openai.yaml`)).toContain("allow_implicit_invocation: false");
  });

  test("ships every reference the orchestrator loads", () => {
    for (const ref of [
      "principles.md",
      "agent-prompt-template.md",
      "artifact-contract.md",
      "advisor-compat.md",
      "package-format.md",
      "diagnostics.md",
    ]) {
      expect(text()).toContain(`<this skill's directory>/references/${ref}`);
    }
  });

  test("principles.md lists the twelve default principles in order", () => {
    const items = [...read(`${SKILL}/references/principles.md`).matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test("calls the seven config tools", () => {
    for (const tool of [
      "config_context",
      "workflow_export",
      "workflow_validate",
      "workflow_import",
      "workflow_readiness",
      "skill_fetch",
      "flow_bind",
    ]) {
      expect(text()).toContain(tool);
    }
  });

  test("names every error code and reason it handles", () => {
    for (const code of [
      "FORBIDDEN",
      "project_role_required",
      "http_only",
      "CONFLICT",
      "repo_branch_not_found",
      "code_repository_bound",
      "checkout_moved",
      "version_conflict",
      "INVALID_INPUT",
      "unsupported_source",
      "unknown_tracker_status",
      "status_already_bound",
      "NOT_FOUND",
      ...TRACKER_ERRORS,
    ]) {
      expect(text()).toContain(code);
    }
  });

  test("preflight bootstraps a missing crux MCP and stops", () => {
    for (const word of [".mcp.json", "${CRUX_MCP_TOKEN}", ".claude/settings.local.json", "Connect your local agents", "restart Claude Code", "/setup"]) {
      expect(section(1)).toContain(word);
    }
    expect(section(1)).toContain("rulesVersion");
    expect(section(1)).toContain("lastCheck");
    expect(section(1)).toContain("-g");
  });

  test("merges dashboard edits file by file and never replaces skills/ or mcp/", () => {
    expect(section(2)).toContain("editedSinceImport");
    expect(section(2)).toContain("workflow_export");
    expect(section(2)).toContain("file by file");
    expect(section(2)).toMatch(/never[^.]*`skills\/`[^.]*`mcp\/`/);
  });

  test("works on one config branch, or a local folder when the project has no code repository", () => {
    expect(section(2)).toContain("<this skill's directory>/scripts/config-branch.sh");
    expect(section(2)).toContain("crux-config/<projectKey>");
    expect(section(2)).toContain("`repos.code` is null");
    expect(text()).not.toMatch(/--force|push -f\b/);
  });

  test("marks each stage in the menu", () => {
    for (const mark of ["changed locally", "matches the active version", "defaulted", "never configured"]) {
      expect(section(3)).toContain(mark);
    }
  });

  test("runs one stage agent per stage and offers defaults only where they exist", () => {
    const stages = section(4);
    for (const stage of ["product", "roles", "statuses", "levels", "estimates", "pipeline", "chat", "skills", "mcp", "rules", "retro"]) {
      expect(stages).toContain(`crux:config-${stage}`);
    }
    expect(stages).toContain("AskUserQuestion");
    expect(stages).toContain("SendMessage");
    expect(stages).toContain("validate.mjs");
    expect(stages).toContain("Use defaults and continue");
  });

  test("answers every question of the run from CRUX_CONFIG_ANSWERS when it is set", () => {
    const rules = text().split("\n## 1. ")[0] as string;
    expect(rules).toContain("CRUX_CONFIG_ANSWERS");
    expect(rules).toContain("preflight");
  });

  test("ends the ship with the merge line verbatim and offers stock levels", () => {
    expect(section(6)).toContain("verbatim: **The new workflow starts working after the merge.**");
    const format = read(`${SKILL}/references/package-format.md`);
    for (const level of ["Epic", "Story", "Task", "Bug"]) expect(format).toContain(`### ${level}`);
  });

  test("ships after the critic, a validation by ref and the person's yes", () => {
    expect(section(5)).toContain("crux:config-critic");
    const ship = section(6);
    for (const word of ["workflow_validate", "preview", "is this all correct?", "expected_sha", "expected_version", "workflow_readiness", "starts working after the merge", "activate_now", "files"]) {
      expect(ship).toContain(word);
    }
  });

  test("reads only fields the recorded tool answers carry", () => {
    const reads: [string, string, string][] = [
      ["new-project", "config_context", "rulesVersion"],
      ["new-project", "config_context", "project.key"],
      ["new-project", "config_context", "repos.code.branch"],
      ["new-project", "config_context", "tracker.statuses"],
      ["new-project", "config_context", "tracker.issueTypes"],
      ["new-project", "config_context", "llmProviders"],
      ["dashboard-drift", "config_context", "workflow.editedSinceImport"],
      ["dashboard-drift", "config_context", "pending.lastCheck.outcome"],
      ["dashboard-drift", "config_context", "pending.prUrl"],
      ["dashboard-drift", "workflow_export", "archiveUrl"],
      ["new-project", "workflow_validate", "issues"],
      ["new-project", "workflow_import", "pending.prUrl"],
      ["new-project", "workflow_readiness", "unboundFlows"],
      ["new-project", "workflow_readiness", "missingSecrets"],
      ["new-project", "workflow_readiness", "notExposedLocally"],
      ["new-project", "skill_fetch", "lockEntry"],
      ["repo-less", "config_context", "repos.code"],
    ];
    for (const [scenario, tool, path] of reads) {
      expect(text()).toContain(path.split(".").at(-1) as string);
      expect(at(recorded(scenario, tool), path)).not.toBeUndefined();
    }
    expect(at(recorded("repo-less", "config_context"), "repos.code")).toBeNull();
  });
});
