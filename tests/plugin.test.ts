import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const json = (rel: string) => JSON.parse(read(rel));

// A skill is a folder with a SKILL.md: `crux-config` ships only its validator until its skill lands.
const SKILLS = readdirSync(join(ROOT, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, "skills", entry.name, "SKILL.md")))
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
  test("ships the three crux skills in a flat skills/ directory", () => {
    expect(SKILLS).toEqual(["crux-dispatch", "crux-run", "crux-worktree"]);
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

describe("session-starting skills", () => {
  for (const skill of ["crux-dispatch", "crux-run"]) {
    test(`${skill} names the tracker claim errors and their reasons`, () => {
      const text = read(`skills/${skill}/SKILL.md`);
      for (const code of [
        "TRACKER_IDENTITY_REQUIRED",
        "TRACKER_AUTH",
        "upstream_auth",
        "TRACKER_UNAVAILABLE",
        "upstream_unavailable",
      ]) {
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
