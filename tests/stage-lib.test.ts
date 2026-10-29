import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerFor, applyChanges, parseReply } from "./harness/stage-lib";

const ROOT = join(import.meta.dir, "..");
const VALIDATOR = join(ROOT, "skills/crux-config/scripts/validate.mjs");

/** A throwaway copy of the generic package. */
const generic = () => {
  const dir = join(mkdtempSync(join(tmpdir(), "stage-lib-")), ".crux");
  cpSync(join(import.meta.dir, "fixtures/generic/.crux"), dir, { recursive: true, verbatimSymlinks: true });
  return dir;
};
const yaml = (crux: string, file = "workflow.yaml") =>
  Bun.YAML.parse(readFileSync(join(crux, file), "utf8")) as Record<string, any>;
const validate = (crux: string) => {
  const proc = Bun.spawnSync(["bun", VALIDATOR, "--json", crux]);
  return JSON.parse(proc.stdout.toString()) as { valid: boolean; issues: { severity: string; path: string; message: string }[] };
};

describe("parseReply", () => {
  test("reads a bare JSON object", () => {
    expect(parseReply('{"questions": [], "draft": "x"}')).toEqual({ questions: [], draft: "x" });
  });

  test("reads the object out of a fenced block with prose around it", () => {
    expect(parseReply('Here it is:\n\n```json\n{"approvedSummary": "s", "changes": []}\n```\nDone.')).toEqual({
      approvedSummary: "s",
      changes: [],
    });
  });

  test("throws when the reply holds no JSON object", () => {
    expect(() => parseReply("I need more information.")).toThrow("no JSON object in the reply");
  });
});

describe("applyChanges", () => {
  test("sets a dotted field of workflow.yaml, a status name with a space included", () => {
    const crux = generic();
    applyChanges(crux, [{ op: "set", path: "workflow.yaml#roleFlows.To Do.pipeline", value: [] }]);
    expect(yaml(crux).roleFlows["To Do"].pipeline).toEqual([]);
    expect(yaml(crux).roleFlows["To Do"].chatAgents).toEqual(["status-reporter"]);
  });

  test("a null value deletes the field", () => {
    const crux = generic();
    applyChanges(crux, [{ op: "set", path: "workflow.yaml#estimates", value: "on" }]);
    expect(yaml(crux).estimates).toBe("on");
    applyChanges(crux, [{ op: "set", path: "workflow.yaml#estimates", value: null }]);
    expect("estimates" in yaml(crux)).toBe(false);
  });

  test("writes sorted keys and one final newline", () => {
    const crux = generic();
    applyChanges(crux, [{ op: "set", path: "workflow.yaml#entryFlow", value: "Done" }]);
    const text = readFileSync(join(crux, "workflow.yaml"), "utf8");
    expect(text.endsWith("\n") && !text.endsWith("\n\n")).toBe(true);
    const top = text.split("\n").filter((line) => /^\S/.test(line)).map((line) => line.split(":")[0]);
    expect(top).toEqual([...top].sort());
    expect(validate(crux).valid).toBe(true);
  });

  test("creates the Context section of ADVISORS.md after its title and keeps the rest", () => {
    const crux = generic();
    applyChanges(crux, [{ op: "set", path: "ADVISORS.md#Context", value: "A web shop." }]);
    const text = readFileSync(join(crux, "ADVISORS.md"), "utf8");
    expect(text.startsWith("# Shared rules\n\n## Context\n\nA web shop.\n")).toBe(true);
    expect(text).toContain("1. One agent, one responsibility.");
    applyChanges(crux, [{ op: "set", path: "ADVISORS.md#Context", value: "A furniture shop." }]);
    const again = readFileSync(join(crux, "ADVISORS.md"), "utf8");
    expect(again).toContain("A furniture shop.");
    expect(again).not.toContain("A web shop.");
    expect(again).toContain("1. One agent, one responsibility.");
  });

  test("adds an agent, an attachment, a skill and a server, and the package still validates", () => {
    const crux = generic();
    const refiner = (f: string) => readFileSync(join(crux, "agents/refiner", f), "utf8");
    applyChanges(crux, [
      {
        op: "add",
        kind: "agent",
        name: "clarifier",
        value: { "agent.yaml": refiner("agent.yaml").replace("acceptance-criteria", "clarifications"), "system-prompt.md": "Clarify.\n", "first-message.md": "Work ticket {{ticket.id}}.\n" },
      },
      { op: "set", path: "workflow.yaml#roleFlows.To Do.pipeline", value: ["refiner", "clarifier"] },
      { op: "add", kind: "skill", name: "grill-me", value: { source: "mattpocock/skills@grill-me" } },
      { op: "add", kind: "attachment", name: "clarifier", value: { skill: "grill-me" } },
      { op: "add", kind: "server", name: "sentry", value: { type: "http", url: "https://mcp.sentry.dev/mcp", headers: { Authorization: "Bearer ${SENTRY_TOKEN}" } } },
      { op: "add", kind: "attachment", name: "clarifier", value: { server: "sentry" } },
    ]);
    expect(readlinkSync(join(crux, "agents/clarifier/skills/grill-me"))).toBe("../../../skills/grill-me");
    expect(readlinkSync(join(crux, "agents/clarifier/mcp/sentry.json"))).toBe("../../../mcp/sentry.json");
    expect(yaml(crux).skills).toEqual([{ name: "grill-me", source: "mattpocock/skills@grill-me" }]);
    expect(yaml(crux).mcpServers).toEqual([{ name: "sentry" }]);
    const errors = validate(crux).issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  test("adds a level file", () => {
    const crux = generic();
    applyChanges(crux, [{ op: "add", kind: "level", name: "Spike", value: "## Description\n\nA time-boxed investigation.\n\n## Structure\n\n## Question\n" }]);
    expect(existsSync(join(crux, "levels/Spike.md"))).toBe(true);
  });

  test("refuses a rename", () => {
    expect(() => applyChanges(generic(), [{ op: "rename", kind: "role", from: "developer", to: "dev" }])).toThrow(
      "rename is not applied by the harness",
    );
  });
});

describe("answerFor", () => {
  const answers = [
    { question: "roles", answer: "a product owner and developers" },
    { question: "Roles", answer: "second" },
    { question: "*", answer: "your proposal is fine" },
  ];

  test("takes the first unused entry whose question occurs in the question, ignoring case", () => {
    const used = new Set<number>();
    expect(answerFor("Which ROLES do people hold?", answers, used)).toBe("a product owner and developers");
    expect(answerFor("Which roles do people hold?", answers, used)).toBe("second");
  });

  test("a * entry answers anything and is never used up", () => {
    const used = new Set<number>();
    expect(answerFor("What colour?", answers, used)).toBe("your proposal is fine");
    expect(answerFor("What icon?", answers, used)).toBe("your proposal is fine");
  });

  test("no match and no * → undefined", () => {
    expect(answerFor("anything", [{ question: "roles", answer: "x" }], new Set())).toBeUndefined();
  });
});
