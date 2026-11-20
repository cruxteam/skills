import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { packageFiles, rpcResult } from "./harness/stage-repo-less";

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
