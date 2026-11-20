#!/usr/bin/env bun
/**
 * The repo-less leg of crux-config against a real CRUX server (stage), without a model: the tool
 * calls `/crux:crux-config` makes for a project with no code repository, in its order.
 *
 *   bun tests/harness/stage-repo-less.ts --url <https://stage.crux.team/mcp/p/<projectId>> --token-file <path> [--import]
 *     [--resolve object-store:9000=127.0.0.1:9003]   (a local stack: its signed URLs name the in-network store)
 *
 * `--token-file` holds the person's `crux_pat_…` token; it is sent only as the Authorization header
 * and never printed. Steps: `config_context` (must answer `repos.code: null`) → `workflow_export`
 * when a workflow exists (else the `name-only-index` fixture) → each `skills` index entry with a
 * `source` fetched with `skill_fetch` into a temporary `.claude/skills/<name>/` → `workflow_validate
 * {files}` → `workflow_import {files, expected_version, preview}`. With `--import` (it activates the
 * package on that project) also `workflow_import {files, expected_version}` and `workflow_readiness`.
 */
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

/** The package as `workflow_validate {files}` takes it: text files by path, never skills/, mcp/ or links. */
export function packageFiles(crux: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const name of readdirSync(join(crux, rel)).sort()) {
      const path = rel === "" ? name : `${rel}/${name}`;
      const stat = lstatSync(join(crux, path));
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (path === "skills" || path === "mcp" || /^agents\/[^/]+\/(skills|mcp)$/.test(path)) continue;
        walk(path);
      } else if (path !== "skills-lock.json") {
        files[path] = readFileSync(join(crux, path), "utf8");
      }
    }
  };
  walk("");
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The tool's answer from a JSON-RPC response body (JSON or an event stream); a refusal throws. */
export function rpcResult(body: string): unknown {
  const line = body.trimStart().startsWith("{")
    ? body
    : body
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .at(-1);
  if (line === undefined) throw new Error(`no JSON-RPC answer in: ${body.slice(0, 200)}`);
  const message = JSON.parse(line) as {
    error?: { message: string };
    result?: { isError?: boolean; content?: { text?: string }[] };
  };
  if (message.error) throw new Error(`JSON-RPC error: ${message.error.message}`);
  const text = message.result?.content?.[0]?.text ?? "null";
  if (message.result?.isError) {
    let refusal: { code?: string; message?: string; data?: { reason?: string } };
    try {
      refusal = JSON.parse(text);
    } catch {
      throw new Error(text);
    }
    throw new Error(`${refusal.code} ${refusal.data?.reason ?? "-"}: ${refusal.message}`);
  }
  return JSON.parse(text);
}

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      "token-file": { type: "string" },
      import: { type: "boolean", default: false },
      resolve: { type: "string" },
    },
  });
  if (!values.url || !values["token-file"]) {
    console.error("usage: bun tests/harness/stage-repo-less.ts --url <mcp url> --token-file <path> [--import]");
    process.exit(2);
  }
  const url = values.url;
  const token = readFileSync(values["token-file"], "utf8").trim();
  let session: string | undefined;
  let id = 0;

  const post = async (method: string, params: Record<string, unknown>, notify = false) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(session ? { "Mcp-Session-Id": session } : {}),
      },
      body: JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++id, method, params }),
    });
    session = res.headers.get("mcp-session-id") ?? session;
    const body = await res.text();
    if (!res.ok && !notify) throw new Error(`${method}: HTTP ${res.status} ${body.slice(0, 300)}`);
    return body;
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const answer = rpcResult(await post("tools/call", { name, arguments: args })) as Record<string, unknown>;
    console.log(`✓ ${name}${args.preview ? " (preview)" : ""}`);
    return answer;
  };
  const unzip = (zip: string, into: string) => {
    mkdirSync(into, { recursive: true });
    const proc = Bun.spawnSync(["unzip", "-qo", zip, "-d", into]);
    if (proc.exitCode !== 0) throw new Error(`unzip: ${proc.stderr.toString()}`);
  };
  /** `--resolve host:port=addr:port` (as curl's): reach a signed URL's host at another address, Host kept. */
  const [from, to_] = (values.resolve ?? "").split("=");
  const download = async (href: string, to: string) => {
    const url = new URL(href);
    const res =
      from && to_ && url.host === from
        ? await fetch(`${url.protocol}//${to_}${url.pathname}${url.search}`, { headers: { Host: from } })
        : await fetch(href);
    if (!res.ok) throw new Error(`download: HTTP ${res.status}`);
    writeFileSync(to, new Uint8Array(await res.arrayBuffer()));
  };

  await post("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "crux-config-harness", version: "0" } });
  await post("notifications/initialized", {}, true);

  const work = mkdtempSync(join(tmpdir(), "crux-config-stage-"));
  console.log(`folder: ${work}`);
  const context = await call("config_context");
  if ((context.repos as { code: unknown }).code !== null) throw new Error("the project binds a code repository: pick a repo-less one");
  const workflow = context.workflow as { version: number } | undefined;

  let crux = join(import.meta.dir, "../fixtures/name-only-index/.crux");
  if (workflow) {
    const exported = await call("workflow_export");
    await download(String(exported.archiveUrl), join(work, "export.zip"));
    unzip(join(work, "export.zip"), work);
    crux = join(work, ".crux");
    if (!existsSync(join(crux, "workflow.yaml"))) throw new Error("the export has no .crux/workflow.yaml");
  }

  const index = (Bun.YAML.parse(readFileSync(join(crux, "workflow.yaml"), "utf8")) as { skills?: { name: string; source?: string }[] })
    .skills ?? [];
  for (const entry of index) {
    if (entry.source === undefined) {
      console.log(`- ${entry.name}: no source`);
      continue;
    }
    const fetched = await call("skill_fetch", { source: entry.source, skill: entry.name });
    const zip = join(work, `${entry.name}.zip`);
    await download(String(fetched.archiveUrl), zip);
    unzip(zip, join(work, ".claude/skills", entry.name));
    if (!existsSync(join(work, ".claude/skills", entry.name, "SKILL.md"))) throw new Error(`${entry.name}: no SKILL.md after unzip`);
  }

  const files = packageFiles(crux);
  const expected_version = workflow?.version ?? 0;
  const checked = (await call("workflow_validate", { files })) as { valid: boolean; issues: { path: string; message: string; severity: string }[] };
  for (const issue of checked.issues) console.log(`  ${issue.severity} ${issue.path}: ${issue.message}`);
  if (!checked.valid) throw new Error("workflow_validate: invalid");
  const preview = await call("workflow_import", { files, expected_version, preview: true });
  console.log(`  counts ${JSON.stringify(preview.counts)}`);

  if (values.import) {
    const imported = await call("workflow_import", { files, expected_version });
    console.log(`  version ${imported.version}, unchanged ${imported.unchanged}`);
    const readiness = await call("workflow_readiness");
    if (readiness.checkout !== "not_bound") throw new Error(`workflow_readiness: checkout ${readiness.checkout}`);
    console.log(`  nameOnly ${JSON.stringify(readiness.nameOnly)}`);
  }
  console.log("PASS");
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
