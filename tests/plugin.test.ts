import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const json = (rel: string) => JSON.parse(read(rel));

// `crux-config` ships only its validator until CF-13 adds its SKILL.md; every other folder is a skill.
const VALIDATOR_ONLY = "crux-config";
const SKILLS = readdirSync(join(ROOT, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== VALIDATOR_ONLY)
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
  test("ships the four crux skills in a flat skills/ directory", () => {
    expect(SKILLS).toEqual(["crux-dispatch", "crux-retro", "crux-run", "crux-worktree"]);
  });

  test("crux-config holds only its validator until its SKILL.md lands", () => {
    expect(readdirSync(join(ROOT, "skills", VALIDATOR_ONLY), { recursive: true }).sort()).toEqual([
      "scripts",
      "scripts/validate.mjs",
    ]);
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
