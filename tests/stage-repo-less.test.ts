import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isNeverSent, packageFiles, parseResolve, rpcResult } from "./harness/stage-repo-less";

const NAME_ONLY = join(import.meta.dir, "fixtures/name-only-index/.crux");
const VALID = join(import.meta.dir, "fixtures/valid/.crux");

describe("stage-repo-less", () => {
  test("packageFiles sends the package's text files by relative path, sorted", () => {
    const files = packageFiles(NAME_ONLY);
    expect(Object.keys(files)).toEqual([
      "ADVISORS.md",
      "agents/developer/agent.yaml",
      "agents/developer/first-message.md",
      "agents/developer/system-prompt.md",
      "agents/helper/agent.yaml",
      "agents/helper/system-prompt.md",
      "agents/planner/agent.yaml",
      "agents/planner/desktop-overrides.md",
      "agents/planner/first-message.md",
      "agents/planner/system-prompt.md",
      "levels/Task.md",
      "workflow.yaml",
    ]);
    expect(files["workflow.yaml"]).toContain("source: acme/skills@decompose");
  });

  test("packageFiles never sends skills/, mcp/, skills-lock.json or attachment links", () => {
    const paths = Object.keys(packageFiles(VALID));
    expect(paths.filter((p) => /^skills\/|^mcp\/|^skills-lock\.json$|\/(skills|mcp)\//.test(p))).toEqual([]);
    expect(paths).toContain("workflow.yaml");
    const copy = join(mkdtempSync(join(tmpdir(), "stage-repo-less-")), ".crux");
    cpSync(NAME_ONLY, copy, { recursive: true });
    writeFileSync(join(copy, "skills-lock.json"), "{}\n");
    expect(Object.keys(packageFiles(copy))).not.toContain("skills-lock.json");
  });

  test("isNeverSent names skills/, mcp/, skills-lock.json and an agent's attachment links", () => {
    for (const path of ["skills/a/SKILL.md", "mcp/docs.json", "skills-lock.json", "agents/planner/skills/a", "agents/planner/mcp"]) {
      expect(isNeverSent(path)).toBe(true);
    }
    for (const path of ["workflow.yaml", "agents/planner/agent.yaml", "levels/Task.md", "skills.md"]) {
      expect(isNeverSent(path)).toBe(false);
    }
  });

  test("parseResolve takes one host:port=addr:port and refuses other shapes", () => {
    expect(parseResolve("object-store:9000=127.0.0.1:9003")).toEqual({ from: "object-store:9000", to: "127.0.0.1:9003" });
    for (const bad of ["object-store:9000", "a:1=b:2=c:3", "object-store=127.0.0.1:9003", "object-store:9000=127.0.0.1"]) {
      expect(parseResolve(bad)).toBeNull();
    }
  });

  test("rpcResult throws on an answer with no text or a non-object", () => {
    const empty = { jsonrpc: "2.0", id: 1, result: { content: [] } };
    expect(() => rpcResult(JSON.stringify(empty))).toThrow("no text content");
    const scalar = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "null" }] } };
    expect(() => rpcResult(JSON.stringify(scalar))).toThrow("not a JSON object");
  });

  test("rpcResult reads a JSON answer and an event-stream answer alike", () => {
    const answer = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: '{"valid":true}' }] } };
    expect(rpcResult(JSON.stringify(answer))).toEqual({ valid: true });
    expect(rpcResult(`event: message\ndata: ${JSON.stringify(answer)}\n\n`)).toEqual({ valid: true });
  });

  test("rpcResult throws a tool refusal with its code and reason", () => {
    const refusal = { code: "CONFLICT", message: "bound", data: { reason: "code_repository_bound" } };
    const answer = { jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: JSON.stringify(refusal) }] } };
    expect(() => rpcResult(JSON.stringify(answer))).toThrow("CONFLICT code_repository_bound: bound");
  });
});
