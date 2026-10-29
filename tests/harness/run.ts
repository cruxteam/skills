#!/usr/bin/env bun
/**
 * Manual fixture runs of crux-config (CF-13): headless Claude Code against the recorded tool
 * answers, with stub stage agents and the answers fixture instead of a person. Costs model tokens,
 * so `bun test` never runs it.
 *
 *   bun tests/harness/run.ts <new-project|edit|dashboard-drift|missing-mcp> [--model <model>] [--token-file <path>]
 *
 * `--token-file` names a file holding a `claude setup-token` token; it reaches only the child
 * `claude` (as CLAUDE_CODE_OAUTH_TOKEN) and is never printed.
 *
 * Each run builds a sandbox (a bare origin and a clone holding the scenario's starting `.crux/`),
 * a copy of this plugin with the stub agents in `agents/`, runs
 * `claude -p "/crux:crux-config …"` in the clone, then checks what it left and prints a report.
 * The sandbox stays in the printed folder for inspection.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const ROOT = join(import.meta.dir, "../..");
const GENERIC = join(ROOT, "tests/fixtures/generic/.crux");
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { model: { type: "string", default: "sonnet" }, "token-file": { type: "string" } },
});
const scenario = positionals[0] ?? "";

type Answer = { question: string; answer: string };
type Stub = { summary: string; changes: unknown[] };
type Scenario = {
  /** The recorded answers' folder; none runs without the crux MCP server. */
  tools?: string;
  /** The `.crux/` on origin's main branch before the run. */
  seed?: boolean;
  args: string;
  stubs: Record<string, Stub>;
  answers: Answer[];
  check: (ctx: { sandbox: string; clone: string; origin: string; calls: Call[]; transcript: string }) => string[];
};
type Call = { tool: string; args: Record<string, unknown> };

const read = (path: string) => readFileSync(path, "utf8");
const generic = (rel: string) => read(join(GENERIC, rel));
const genericYaml = Bun.YAML.parse(generic("workflow.yaml")) as Record<string, Record<string, Record<string, unknown>>>;
const flowsWithoutAgents = Object.fromEntries(
  Object.entries(genericYaml.roleFlows).map(([status, flow]) => [status, { ...flow, chatAgents: [], pipeline: [] }]),
);
const agentFiles = (agent: string) =>
  Object.fromEntries(readdirSync(join(GENERIC, "agents", agent)).map((f) => [f, generic(`agents/${agent}/${f}`)]));
const lanes = (lane: "pipeline" | "chatAgents") =>
  Object.entries(genericYaml.roleFlows).map(([status, flow]) => ({
    op: "set",
    path: `workflow.yaml#roleFlows.${status}.${lane}`,
    value: flow[lane],
  }));

const yes = (question: string): Answer => ({ question, answer: "yes" });
const stubQuestion = (stage: string) => yes(`${stage} stub: is the draft right?`);
const useDefaults: Answer = { question: "use defaults", answer: "Use defaults and continue" };
const configureNow: Answer = { question: "use defaults", answer: "configure it now" };

const NEW_PROJECT_STUBS: Record<string, Stub> = {
  product: { summary: "Shop: a web shop. Code on GitHub; English; the team uses Claude Code.", changes: [] },
  roles: {
    summary: "Two roles: product-owner and developer.",
    changes: [{ op: "set", path: "workflow.yaml#roles", value: genericYaml.roles }],
  },
  statuses: {
    summary: "To Do and Done: product-owner; In Progress and In Review: developer. New tickets enter To Do.",
    changes: [
      { op: "set", path: "workflow.yaml#roleFlows", value: flowsWithoutAgents },
      { op: "set", path: "workflow.yaml#entryFlow", value: "To Do" },
    ],
  },
  pipeline: {
    summary: "refiner (To Do), planner (In Progress), reviewer (In Review), each with one artifact.",
    changes: [
      ...["refiner", "planner", "reviewer"].map((name) => ({ op: "add", kind: "agent", name, value: agentFiles(name) })),
      ...lanes("pipeline"),
    ],
  },
  chat: {
    summary: "status-reporter answers status questions in To Do.",
    changes: [{ op: "add", kind: "agent", name: "status-reporter", value: agentFiles("status-reporter") }, ...lanes("chatAgents")],
  },
  critic: { summary: "No findings.", changes: [] },
};

const SCENARIOS: Record<string, Scenario> = {
  "new-project": {
    tools: "new-project",
    args: "",
    stubs: NEW_PROJECT_STUBS,
    answers: [
      { question: "find-skills", answer: "no" },
      { question: "grill-me", answer: "no" },
      stubQuestion("product"),
      yes("approve stage"),
      stubQuestion("roles"),
      yes("approve stage"),
      stubQuestion("statuses"),
      yes("approve stage"),
      useDefaults, // S4 levels
      useDefaults, // S5 estimates
      stubQuestion("pipeline"),
      yes("approve stage"),
      configureNow, // S7 chat
      stubQuestion("chat"),
      yes("approve stage"),
      useDefaults, // S8 skills
      useDefaults, // S9 MCP
      useDefaults, // S10 rules
      useDefaults, // S11 retro
      yes("is this all correct?"),
    ],
    check: ({ origin, calls, transcript }) => {
      const problems = shipChecks(origin, calls, transcript);
      const tree = git(origin, "ls-tree", "-r", "--name-only", "crux-config/KAN", ".crux");
      for (const level of ["Bug", "Story", "Task"]) {
        if (!tree.includes(`.crux/levels/${level}.md`)) problems.push(`no defaulted level ${level}`);
      }
      const workflow = git(origin, "show", "crux-config/KAN:.crux/workflow.yaml");
      if (/^estimates: on/m.test(workflow)) problems.push("estimates were not left off by the S5 default");
      return problems;
    },
  },
  edit: {
    tools: "edit",
    seed: true,
    args: "edit refiner",
    stubs: {
      pipeline: {
        summary: "refiner also asks who the change is for.",
        changes: [
          {
            op: "set",
            path: "agents/refiner/first-message.md",
            value: "Work ticket {{ticket.id}}: {{ticket.title}}. Start by asking who the change is for.\n",
          },
        ],
      },
      critic: { summary: "No findings.", changes: [] },
    },
    answers: [
      { question: "find-skills", answer: "no" },
      { question: "grill-me", answer: "no" },
      stubQuestion("pipeline"),
      yes("approve stage"),
      useDefaults, // S8 for refiner
      yes("is this all correct?"),
    ],
    check: ({ origin, calls, transcript }) => {
      const problems = shipChecks(origin, calls, transcript);
      const message = git(origin, "show", "crux-config/KAN:.crux/agents/refiner/first-message.md");
      if (!message.includes("who the change is for")) problems.push("the refiner edit did not land");
      const launched = [...transcript.matchAll(/"subagent_type":"crux:config-(\w+)"/g)].map((m) => m[1]);
      const others = launched.filter((stage) => stage !== "pipeline" && stage !== "critic");
      if (others.length > 0) problems.push(`edit launched other stages: ${others.join(", ")}`);
      return problems;
    },
  },
  "dashboard-drift": {
    tools: "dashboard-drift",
    seed: true,
    args: "",
    stubs: { critic: { summary: "No findings.", changes: [] } },
    answers: [
      { question: "find-skills", answer: "no" },
      { question: "grill-me", answer: "no" },
      { question: "merge", answer: "yes, take the dashboard's version of every file" },
      { question: "system-prompt.md", answer: "take the dashboard's version" },
      { question: "stage", answer: "review and ship" },
      yes("is this all correct?"),
    ],
    check: ({ origin, calls, transcript }) => {
      const problems = shipChecks(origin, calls, transcript);
      if (!calls.some((c) => c.tool === "workflow_export")) problems.push("workflow_export was never called");
      const prompt = git(origin, "show", "crux-config/KAN:.crux/agents/refiner/system-prompt.md");
      if (!prompt.includes(DASHBOARD_EDIT)) problems.push("the dashboard edit was not merged");
      const tree = git(origin, "ls-tree", "-r", "--name-only", "crux-config/KAN", ".crux");
      if (!tree.includes(".crux/skills/house-style/SKILL.md")) problems.push("the merge deleted skills/house-style");
      return problems;
    },
  },
  "missing-mcp": {
    args: "",
    stubs: {},
    answers: [
      {
        question: "paste",
        answer: JSON.stringify({
          crux: {
            type: "http",
            url: "https://crux.example/mcp/p/01a15935-4b4c-7163-b51a-fe7845be1d17",
            headers: { Authorization: "Bearer ${CRUX_MCP_TOKEN}" },
          },
        }),
      },
      yes(".mcp.json"),
    ],
    check: ({ clone, origin, calls, transcript }) => {
      const problems: string[] = [];
      // Claude Code guards `.mcp.json` as a sensitive file: interactively the person approves the
      // write; headless it is refused, so the check reads the write the skill asked for.
      const written = read(join(clone, ".mcp.json"));
      const asked = deniedWrite(transcript, ".mcp.json");
      const config = JSON.parse(written.includes('"crux"') ? written : (asked ?? written));
      const entry = config.mcpServers?.crux;
      if (entry === undefined) return ["no crux entry was written or asked for"];
      if (entry.headers?.Authorization !== "Bearer ${CRUX_MCP_TOKEN}") problems.push("the crux entry lost its ${CRUX_MCP_TOKEN} header");
      if (config.mcpServers?.other === undefined) problems.push("the existing `other` entry was dropped");
      if (!/restart Claude Code/i.test(transcript)) problems.push('no "restart Claude Code" instruction');
      if (calls.length > 0) problems.push("tools were called without a crux server");
      if (git(origin, "branch", "--list", "crux-config/*") !== "") problems.push("a config branch was pushed");
      return problems;
    },
  },
};

const DASHBOARD_EDIT = "Always ask for the target customer segment.";

function git(cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
  return proc.stdout.toString().trim();
}

/** The content of a Write or Edit to a file named `name` that the session's permissions refused. */
function deniedWrite(transcript: string, name: string): string | undefined {
  for (const line of transcript.split("\n")) {
    if (!line.includes('"type":"result"')) continue;
    const denials = (JSON.parse(line) as { permission_denials?: { tool_input?: { file_path?: string; content?: string } }[] })
      .permission_denials;
    const write = denials?.find((d) => d.tool_input?.file_path?.endsWith(`/${name}`) && d.tool_input.content);
    if (write) return write.tool_input?.content;
  }
  return undefined;
}

/** What every shipping scenario leaves: a pushed, valid config branch and the import's call order. */
function shipChecks(origin: string, calls: Call[], transcript: string): string[] {
  const problems: string[] = [];
  const branches = git(origin, "branch", "--list", "crux-config/KAN");
  if (branches === "") return ["crux-config/KAN was never pushed"];
  const out = mkdtempSync(join(tmpdir(), "crux-config-pushed-"));
  git(origin, "--work-tree", out, "checkout", "crux-config/KAN", "--", ".crux");
  const validate = Bun.spawnSync(["node", join(ROOT, "skills/crux-config/scripts/validate.mjs"), join(out, ".crux")]);
  if (validate.exitCode !== 0) problems.push(`the pushed .crux/ is invalid: ${validate.stderr.toString().trim()}`);
  const order = calls.map((c) => (c.tool === "workflow_import" && c.args.preview === true ? "preview" : c.tool));
  const expected = ["workflow_validate", "preview", "workflow_import", "workflow_readiness"];
  const at = expected.map((tool) => order.indexOf(tool));
  if (at.some((i) => i === -1) || at.some((i, n) => n > 0 && i < (at[n - 1] ?? 0))) {
    problems.push(`ship calls out of order: ${order.join(" → ")}`);
  }
  const imported = calls.find((c) => c.tool === "workflow_import" && c.args.preview !== true);
  if (imported?.args.activate_now !== undefined) problems.push("activate_now was sent unasked");
  if (typeof imported?.args.expected_sha !== "string") problems.push("the import carried no expected_sha");
  if (!transcript.includes("The new workflow starts working after the merge.")) {
    problems.push('no verbatim "The new workflow starts working after the merge."');
  }
  return problems;
}

function stubAgent(stage: string, stub: Stub): string {
  const name = stage === "critic" ? "config-critic" : `config-${stage}`;
  const open = { questions: [{ id: `${stage}-1`, question: `${stage} stub: is the draft right?`, options: ["yes", "no"] }], draft: stub.summary };
  const close = stage === "critic" ? { findings: [] } : { approvedSummary: stub.summary, changes: stub.changes };
  return [
    "---",
    `name: ${name}`,
    `description: Test stub of the crux-config ${stage} stage. Answers fixed JSON.`,
    "tools: []",
    "---",
    "",
    `You are a test stub of the crux-config stage "${stage}". Read nothing and call no tool.`,
    stage === "critic"
      ? `Answer exactly this JSON and nothing else:\n\n${JSON.stringify(close)}`
      : `To your first message answer exactly this JSON and nothing else:\n\n${JSON.stringify(open)}\n\n` +
        `To any later message answer exactly this JSON and nothing else:\n\n${JSON.stringify(close)}`,
    "",
  ].join("\n");
}

const spec = SCENARIOS[scenario];
if (spec === undefined) {
  console.error(`usage: bun tests/harness/run.ts <${Object.keys(SCENARIOS).join("|")}> [--model <model>]`);
  process.exit(2);
}

// The real path: on macOS the temp folder is a symlink, and permission rules match real paths.
const sandbox = realpathSync(mkdtempSync(join(tmpdir(), `crux-config-${scenario}-`)));
const origin = join(sandbox, "origin.git");
const clone = join(sandbox, "shop");
git(sandbox, "init", "-q", "--bare", "-b", "main", origin);
git(sandbox, "clone", "-q", origin, clone);
writeFileSync(join(clone, "README.md"), "# Shop\n");
writeFileSync(join(clone, ".mcp.json"), `${JSON.stringify({ mcpServers: { other: { type: "http", url: "https://other.example/mcp" } } }, null, 2)}\n`);
if (spec.seed) {
  cpSync(GENERIC, join(clone, ".crux"), { recursive: true, verbatimSymlinks: true });
  if (scenario === "dashboard-drift") {
    mkdirSync(join(clone, ".crux/skills/house-style"), { recursive: true });
    writeFileSync(join(clone, ".crux/skills/house-style/SKILL.md"), "---\nname: house-style\ndescription: Our writing style.\n---\n\nWrite short sentences.\n");
  }
}
git(clone, "add", "-A");
git(clone, "commit", "-q", "-m", "init");
git(clone, "push", "-q", "-u", "origin", "main");
git(clone, "remote", "set-head", "origin", "main");

// The dashboard's export: the seeded package with one edit, without skills/ (D-CF41).
let exportUrl: string | undefined;
if (scenario === "dashboard-drift") {
  const dir = join(sandbox, "export");
  cpSync(GENERIC, join(dir, ".crux"), { recursive: true, verbatimSymlinks: true });
  const prompt = join(dir, ".crux/agents/refiner/system-prompt.md");
  writeFileSync(prompt, `${read(prompt).trimEnd()}\n\n${DASHBOARD_EDIT}\n`);
  Bun.spawnSync(["zip", "-qry", join(sandbox, "export.zip"), ".crux"], { cwd: dir });
  exportUrl = `file://${join(sandbox, "export.zip")}`;
}

// This plugin, plus the scenario's stub agents.
const plugin = join(sandbox, "plugin");
cpSync(ROOT, plugin, { recursive: true, filter: (src) => !src.includes("/.git") && !src.includes("/node_modules") });
mkdirSync(join(plugin, "agents"), { recursive: true });
for (const [stage, stub] of Object.entries(spec.stubs)) {
  writeFileSync(join(plugin, "agents", `${stage === "critic" ? "config-critic" : `config-${stage}`}.md`), stubAgent(stage, stub));
}

const answers = join(sandbox, "answers.json");
writeFileSync(answers, `${JSON.stringify({ answers: spec.answers }, null, 2)}\n`);
const log = join(sandbox, "calls.jsonl");
writeFileSync(log, "");
const mcpConfig = join(sandbox, "mcp.json");
writeFileSync(
  mcpConfig,
  JSON.stringify({
    mcpServers: spec.tools
      ? {
          crux: {
            type: "stdio",
            command: "bun",
            args: [join(import.meta.dir, "mock-crux-mcp.ts")],
            env: {
              MOCK_DIR: join(ROOT, "tests/fixtures/tools", spec.tools),
              MOCK_FALLBACK: join(ROOT, "tests/fixtures/tools/new-project"),
              MOCK_LOG: log,
              MOCK_ORIGIN: origin,
              MOCK_CODE_URL: origin,
              MOCK_SOURCE_SHA: git(clone, "rev-parse", "HEAD"),
              ...(exportUrl ? { MOCK_EXPORT_URL: exportUrl } : {}),
            },
          },
        }
      : {},
  }),
);

/** What the orchestrator needs, and nothing else: no blanket permission bypass. */
const ALLOWED_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Agent",
  "Task",
  "SendMessage",
  "mcp__crux__*",
  // `.mcp.json` is a sensitive file: an interactive session asks the person; the run grants it.
  "Write(./.mcp.json)",
  "Edit(./.mcp.json)",
  ...["git", "sh", "bun", "node", "curl", "unzip", "printenv", "head", "ls", "cat", "mkdir", "ln", "diff", "cp", "test"].map(
    (command) => `Bash(${command}:*)`,
  ),
];

console.error(`sandbox: ${sandbox}`);
const proc = Bun.spawnSync(
  [
    "claude",
    "-p",
    `/crux:crux-config ${spec.args}`.trim(),
    "--plugin-dir",
    plugin,
    "--mcp-config",
    mcpConfig,
    "--strict-mcp-config",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    ...ALLOWED_TOOLS,
    "--model",
    values.model ?? "sonnet",
    "--output-format",
    "stream-json",
    "--verbose",
  ],
  {
    cwd: clone,
    env: {
      ...process.env,
      CRUX_CONFIG_ANSWERS: answers,
      ...(values["token-file"] ? { CLAUDE_CODE_OAUTH_TOKEN: read(values["token-file"]).trim() } : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  },
);
const transcript = proc.stdout.toString();
writeFileSync(join(sandbox, "transcript.jsonl"), transcript);
const calls = read(log)
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Call);

const result = transcript
  .split("\n")
  .filter((line) => line.startsWith('{"') && line.includes('"type":"result"'))
  .map((line) => JSON.parse(line) as { is_error?: boolean; result?: string })
  .at(-1);
const problems = result?.is_error
  ? [`claude failed: ${result.result ?? "no result"}`]
  : spec.check({ sandbox, clone, origin, calls, transcript });
console.log(`# crux-config fixture run: ${scenario}`);
console.log(`claude exit ${proc.exitCode}; tool calls: ${calls.map((c) => c.tool).join(", ") || "none"}`);
console.log(problems.length === 0 ? "PASS" : `FAIL\n${problems.map((p) => `- ${p}`).join("\n")}`);
console.log(`transcript: ${join(sandbox, "transcript.jsonl")}`);
process.exit(problems.length === 0 ? 0 : 1);
