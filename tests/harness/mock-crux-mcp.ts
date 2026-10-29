#!/usr/bin/env bun
/**
 * A stdio stand-in for the crux MCP server's config tools, answering from the recorded answers in
 * `tests/fixtures/tools/<scenario>/`. Only the manual harness (`run.ts`) starts it.
 *
 *   MOCK_DIR         the scenario's folder of recorded answers (`<tool>.json`, `workflow_import.preview.json`)
 *   MOCK_FALLBACK    a folder read for a tool MOCK_DIR has no answer for (the shared ship answers)
 *   MOCK_LOG         a JSONL file each call is appended to: {tool, args}
 *   MOCK_ORIGIN      the sandbox's bare origin: a `ref` argument is resolved there, so answers carry its real sha
 *   MOCK_CODE_URL    replaces `repos.code.webUrl` in `config_context`
 *   MOCK_SOURCE_SHA  replaces `workflow.sourceSha` in `config_context`
 *   MOCK_EXPORT_URL  replaces `archiveUrl` in `workflow_export`
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const env = process.env;
const str = { type: "string" };
const bool = { type: "boolean" };
const files = { type: "object", additionalProperties: { type: "string" } };
/** The tools' input shapes as the api's Zod schemas declare them, so arguments arrive typed. */
const INPUTS: Record<string, Record<string, unknown>> = {
  config_context: {},
  workflow_validate: { ref: str, files },
  workflow_import: {
    ref: str,
    files,
    expected_sha: str,
    expected_version: { type: "integer", minimum: 0 },
    preview: bool,
    activate_now: bool,
  },
  workflow_readiness: { ref: str },
  workflow_export: {},
  skill_fetch: { source: str, skill: str },
  flow_bind: { flow: str, tracker_status: str, accept_proposals: bool },
};
const TOOLS = Object.keys(INPUTS);

type Refusal = { code: string; message: string; data?: Record<string, unknown> };

const recorded = (name: string): Record<string, unknown> | undefined => {
  for (const dir of [env.MOCK_DIR, env.MOCK_FALLBACK]) {
    const path = join(dir ?? "", `${name}.json`);
    if (dir && existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  }
  return undefined;
};

const shaOf = (ref: string): string | Refusal => {
  const name = ref.replace(/^refs\/heads\//, "");
  const proc = Bun.spawnSync(["git", "-C", env.MOCK_ORIGIN ?? ".", "rev-parse", "--verify", "--quiet", `refs/heads/${name}`]);
  const sha = proc.stdout.toString().trim();
  return proc.exitCode === 0 ? sha : { code: "CONFLICT", message: `no branch ${name}`, data: { reason: "repo_branch_not_found" } };
};

function answer(tool: string, args: Record<string, unknown>): unknown {
  if (!TOOLS.includes(tool)) throw { code: "NOT_FOUND", message: `no tool ${tool}` } satisfies Refusal;
  const preview = tool === "workflow_import" && args.preview === true;
  const value = recorded(preview ? "workflow_import.preview" : tool);
  if (value === undefined) throw { code: "NOT_FOUND", message: `no recorded answer for ${tool}` } satisfies Refusal;
  if (typeof args.ref === "string") {
    const sha = shaOf(args.ref);
    if (typeof sha !== "string") throw sha;
    if ("sha" in value) value.sha = sha;
    if (typeof value.pending === "object" && value.pending !== null) Object.assign(value.pending, { sha, ref: args.ref });
    if (typeof args.expected_sha === "string" && args.expected_sha !== sha) {
      throw { code: "CONFLICT", message: "the branch moved", data: { reason: "checkout_moved" } } satisfies Refusal;
    }
  }
  if (tool === "config_context") {
    const code = (value.repos as { code: Record<string, unknown> | null }).code;
    if (code !== null && env.MOCK_CODE_URL) code.webUrl = env.MOCK_CODE_URL;
    const workflow = value.workflow as Record<string, unknown> | undefined;
    if (workflow && env.MOCK_SOURCE_SHA) workflow.sourceSha = env.MOCK_SOURCE_SHA;
  }
  if (tool === "workflow_export" && env.MOCK_EXPORT_URL) value.archiveUrl = env.MOCK_EXPORT_URL;
  return value;
}

const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

function handle(request: { id?: number | string; method: string; params?: Record<string, unknown> }) {
  const { id, method, params = {} } = request;
  if (id === undefined) return; // a notification
  if (method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "crux-mock", version: "0.0.0" },
      },
    });
  }
  if (method === "tools/list") {
    const tools = TOOLS.map((name) => ({
      name,
      description: `Recorded answer of the crux tool ${name}.`,
      inputSchema: { type: "object", properties: INPUTS[name], additionalProperties: false },
    }));
    return send({ jsonrpc: "2.0", id, result: { tools } });
  }
  if (method === "tools/call") {
    const tool = String(params.name);
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    if (env.MOCK_LOG) appendFileSync(env.MOCK_LOG, `${JSON.stringify({ tool, args })}\n`);
    try {
      const text = JSON.stringify(answer(tool, args));
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (refusal) {
      const text = JSON.stringify({ error: refusal });
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: true } });
    }
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `no method ${method}` } });
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  for (let at = buffer.indexOf("\n"); at !== -1; at = buffer.indexOf("\n")) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (line !== "") handle(JSON.parse(line));
  }
});
