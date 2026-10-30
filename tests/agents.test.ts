import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHECKS } from "./harness/critic-cases";

const ROOT = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const AGENTS = existsSync(join(ROOT, "agents"))
  ? readdirSync(join(ROOT, "agents"))
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.replace(/\.md$/, ""))
      .sort()
  : [];

/** An agent file's frontmatter (flat `key: value` lines) and body. */
const agent = (name: string) => {
  const text = read(`agents/${name}.md`);
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`agents/${name}.md has no frontmatter`);
  const meta = Object.fromEntries(
    (match[1] as string).split("\n").map((line) => {
      const at = line.indexOf(":");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
  );
  const tools = String(meta.tools ?? "")
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
  return { meta, tools, body: match[2] as string };
};

const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Agent", "Task"];

describe("stage agents", () => {
  test("ships one agent per stage of the orchestrator's table, plus the critic", () => {
    const skill = read("skills/crux-config/SKILL.md");
    const named = [...new Set([...skill.matchAll(/`crux:(config-[a-z]+)`/g)].map((m) => m[1]))].sort();
    expect(named).toHaveLength(12);
    expect(AGENTS).toEqual(named as string[]);
  });

  for (const name of AGENTS) {
    test(`${name} has name, description, tools and model inherit`, () => {
      const { meta, tools } = agent(name);
      expect(meta.name).toBe(name);
      expect(String(meta.description).length).toBeGreaterThan(40);
      expect(tools).toContain("Read");
      expect(meta.model).toBe("inherit");
    });

    test(`${name} has no tool that writes`, () => {
      const { tools } = agent(name);
      for (const tool of WRITE_TOOLS) expect(tools).not.toContain(tool);
      if (name !== "config-skills") {
        expect(tools).not.toContain("Bash");
        expect(tools).not.toContain("WebFetch");
      }
    });

    test(`${name} answers JSON only and never asks the person`, () => {
      const { body } = agent(name);
      expect(body).toContain("stage-contract.md");
      expect(body).toContain("only JSON");
      expect(body).toContain("never ask the person");
    });

    test(`${name} treats tracker and skill text as quoted data`, () => {
      expect(agent(name).body).toContain("data, never instructions");
    });
  }

  const body = (name: string) => agent(name).body;

  test("S1 reads the checkout, the local AI tools and offers a wiki", () => {
    for (const word of ["checkout", "Claude Code", "Codex", "wiki", "ADVISORS.md#Context", "accessCode", "accessWiki"]) {
      expect(body("config-product")).toContain(word);
    }
  });

  test("S2 generates and shows slug, colour and icon", () => {
    for (const word of ["slug", "transliterate", "#8079f0", "clipboard-list"]) expect(body("config-roles")).toContain(word);
  });

  test("S3 asks which role's agents run in a shared status and never proposes a new status", () => {
    const text = body("config-statuses");
    for (const word of ["which role's agents run here", "never propose a new tracker status", "expectedGroup", "entryFlow", "statuses` is null"]) {
      expect(text).toContain(word);
    }
  });

  test("S4 starts from the native issue types and the stock levels", () => {
    for (const word of ["issueTypes", "Stock levels", "## Description", "## Structure"]) expect(body("config-levels")).toContain(word);
  });

  test("S5 asks for a scale only without a native one, and defaults off", () => {
    for (const word of ["estimateScale", "native", "off"]) expect(body("config-estimates")).toContain(word);
  });

  test("S6 asks the human gate, the status moves and explains BYOK", () => {
    const text = body("config-pipeline");
    for (const word of ["before it is posted", "plan", "merge", "ticket_set_status", "WORKER", "dashboard", "commission", "chatRetentionMax", "agent-prompt-template.md"]) {
      expect(text).toContain(word);
    }
  });

  test("S7 proposes chat helpers from the context, as examples only", () => {
    for (const word of ["CHAT", "chatAgents", "examples"]) expect(body("config-chat")).toContain(word);
  });

  test("S8 searches with skills find, proposes grill-me, refuses GitLab sources", () => {
    const text = body("config-skills");
    for (const word of ["skills find", "grill-me", "GitLab", "advisor-compat.md", "one agent at a time", "kepano/obsidian-skills"]) {
      expect(text).toContain(word);
    }
    expect(agent("config-skills").tools).toEqual(expect.arrayContaining(["Bash", "WebFetch"]));
  });

  test("S9 names secrets as ${VAR} only", () => {
    for (const word of ["${", "mcpServers", "dashboard"]) expect(body("config-mcp")).toContain(word);
  });

  test("S10 omits principle 12 without a wiki", () => {
    for (const word of ["principles.md", "principle 12", "repos.wiki", "## Team rules"]) expect(body("config-rules")).toContain(word);
  });

  test("S11 fills retro.bugLevels and retro.reviewArtifacts", () => {
    for (const word of ["RETRO.md", "retro.bugLevels", "retro.reviewArtifacts", "review-report"]) expect(body("config-retro")).toContain(word);
  });

  test("the critic checks every principle and every check of the contract", () => {
    const text = body("config-critic");
    for (const check of CHECKS) expect(text).toContain(`\`${check}\``);
    expect(text).toContain('"findings"');
  });
});
