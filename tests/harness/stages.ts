#!/usr/bin/env bun
/**
 * Manual fixture runs of the crux-config stage agents (CF-14). Each case drives one agent
 * directly — `claude -p --agent crux:config-<stage>` — with the launch message of
 * `references/stage-contract.md`, answers its questions from the case's answers, resumes it until it
 * closes, applies its `changes` to the seeded `.crux/`, runs `validate.mjs` and checks the result.
 * The critic leg runs `crux:config-critic` on each seeded violation of `critic-cases.ts`. Costs
 * model tokens, so `bun test` never runs it.
 *
 *   bun tests/harness/stages.ts [<stage>|critic|all] [--tracker <kind>] [--case <id>] [--jobs 4]
 *                               [--model sonnet] [--ollama <model>] [--token-file <path>]
 *
 * `--ollama <model>` points the child `claude` at a local Ollama (`http://localhost:11434`), to
 * iterate on a prompt for free; confirm on Claude afterwards. `--token-file` names a file holding a
 * `claude setup-token` token, handed only to the child as CLAUDE_CODE_OAUTH_TOKEN, never printed.
 */
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { parseArgs } from "node:util";
import { CRITIC_CASES, type CriticCase } from "./critic-cases";
import { STAGE_CASES, type StageCase, type Tracker, writeCheckout } from "./stage-cases";
import { answerFor, applyChanges, CONTEXTS, type Issue, isChange, parseReply, validatePackage } from "./stage-lib";

const ROOT = join(import.meta.dir, "../..");
const MAX_ROUNDS = 8;
const NOT_BARE = "a reply was not a bare JSON object (stage-contract.md, *Your answer*)";
const STAGE_NUMBER: Record<string, string> = {
  product: "S1",
  roles: "S2",
  statuses: "S3",
  levels: "S4",
  estimates: "S5",
  pipeline: "S6",
  chat: "S7",
  skills: "S8",
  mcp: "S9",
  rules: "S10",
  retro: "S11",
  critic: "S12",
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    tracker: { type: "string" },
    case: { type: "string" },
    jobs: { type: "string", default: "4" },
    model: { type: "string", default: "sonnet" },
    ollama: { type: "string" },
    "token-file": { type: "string" },
  },
});
const target = positionals[0] ?? "all";

const read = (path: string) => readFileSync(path, "utf8");
const contextOf = (tracker: Tracker, wiki = false) => {
  const context = JSON.parse(read(join(ROOT, "tests/fixtures/tools", CONTEXTS[tracker], "config_context.json")));
  if (wiki && context.repos.wiki === undefined) context.repos.wiki = { webUrl: "https://github.com/example/shop-wiki", branch: "main" };
  return context;
};

// ---------------------------------------------------------------------------
// One sandbox per run: this plugin, a checkout, a stub `skills find`.
// ---------------------------------------------------------------------------

const sandboxRoot = realpathSync(mkdtempSync(join(tmpdir(), "crux-config-stages-")));
const plugin = join(sandboxRoot, "plugin");
const SKIPPED = new Set([".git", ".github", "node_modules", "tests"]);
cpSync(ROOT, plugin, { recursive: true, filter: (src) => !SKIPPED.has(relative(ROOT, src).split(sep)[0] ?? "") });
const references = ["stage-contract.md", "principles.md", "agent-prompt-template.md", "artifact-contract.md", "advisor-compat.md", "package-format.md"].map(
  (file) => join(plugin, "skills/crux-config/references", file),
);
const bin = join(sandboxRoot, "bin");
mkdirSync(bin);
const recordedFind = `'${join(ROOT, "tests/fixtures/tools/skills-find.txt").replaceAll("'", `'\\''`)}'`;
for (const runner of ["bunx", "npx"]) {
  writeFileSync(
    join(bin, runner),
    `#!/bin/sh\nif [ "$1" = skills ] && [ "$2" = find ]; then cat ${recordedFind}; exit 0; fi\necho "stub ${runner}: only 'skills find' runs here" >&2\nexit 1\n`,
  );
  chmodSync(join(bin, runner), 0o755);
}

/** The agent's tools, from its frontmatter; S8's shell and fetch are narrowed to the search and skill pages. */
function toolsOf(agent: string): { tools: string[]; allowed: string[] } {
  const line = read(join(ROOT, "agents", `${agent}.md`)).match(/^tools: (.*)$/m)?.[1] ?? "";
  const tools = line.split(",").map((t) => t.trim()).filter(Boolean);
  const allowed = tools.flatMap((tool) =>
    tool === "Bash" ? ["Bash(bunx skills find:*)", "Bash(npx skills find:*)"] : tool === "WebFetch" ? ["WebFetch(domain:skills.sh)"] : [tool],
  );
  return { tools, allowed };
}

/** The child's environment: no parent session's variables; Ollama or a token when asked. */
function childEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDE_PID|CLAUDE_EFFORT)/.test(key)),
  ) as Record<string, string>;
  env.PATH = `${bin}:${env.PATH ?? ""}`;
  if (values.ollama) Object.assign(env, { ANTHROPIC_BASE_URL: "http://localhost:11434", ANTHROPIC_AUTH_TOKEN: "ollama", ANTHROPIC_API_KEY: "" });
  if (values["token-file"]) env.CLAUDE_CODE_OAUTH_TOKEN = read(values["token-file"]).trim();
  return env;
}

type Turn = { text: string; sessionId: string };

async function turn(agent: string, cwd: string, message: string, sessionId?: string): Promise<Turn> {
  const { tools, allowed } = toolsOf(agent);
  const args = [
    "claude",
    "-p",
    message,
    "--plugin-dir",
    plugin,
    "--agent",
    `crux:${agent}`,
    "--add-dir",
    plugin,
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--tools",
    tools.join(","),
    "--allowedTools",
    ...allowed,
    "--model",
    values.ollama ?? values.model ?? "sonnet",
    "--output-format",
    "json",
    ...(sessionId ? ["--resume", sessionId] : []),
  ];
  const proc = Bun.spawn(args, { cwd, env: childEnv(), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  let result: { result?: string; session_id?: string; is_error?: boolean };
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error(`claude exit ${proc.exitCode}: ${(stderr || stdout).trim().slice(0, 400)}`);
  }
  if (result.is_error || typeof result.result !== "string" || !result.session_id) {
    throw new Error(`claude failed: ${String(result.result ?? stderr).slice(0, 400)}`);
  }
  return { text: result.result, sessionId: result.session_id };
}

const validate = (crux: string): Issue[] => validatePackage(crux).issues;
const errors = (issues: Issue[]) => issues.filter((i) => i.severity === "error");

type Outcome = { id: string; problems: string[]; folder: string; rounds: number };

async function runStage(c: StageCase): Promise<Outcome> {
  const folder = join(sandboxRoot, c.id);
  const checkout = join(folder, "shop");
  mkdirSync(checkout, { recursive: true });
  writeCheckout(checkout);
  const crux = join(checkout, ".crux");
  mkdirSync(crux);
  c.seed(crux);
  const before = new Set(errors(validate(crux)).map((e) => `${e.path}: ${e.message}`));
  const launch = {
    stage: STAGE_NUMBER[c.stage],
    configContext: contextOf(c.tracker),
    checkout,
    package: crux,
    approvedSummaries: c.summaries ?? {},
    edit: null,
    paths: null,
    references,
  };
  const agent = `config-${c.stage}`;
  const asked: string[] = [];
  const used = new Set<number>();
  const log: unknown[] = [];
  let message = JSON.stringify(launch);
  let sessionId: string | undefined;
  let notBare = false;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const reply = await turn(agent, checkout, message, sessionId);
    sessionId = reply.sessionId;
    const { value, strict } = parseReply(reply.text);
    if (!strict) notBare = true;
    const parsed = value as {
      questions?: { id: string; question: string; options?: string[] }[];
      draft?: unknown;
      approvedSummary?: string;
      changes?: unknown[];
    };
    log.push(parsed);
    writeFileSync(join(folder, "replies.json"), `${JSON.stringify(log, null, 2)}\n`);
    if (Array.isArray(parsed.changes)) {
      if (round === 1) return { id: c.id, problems: ["closed in its first answer, without asking the person"], folder, rounds: round };
      const invalid = parsed.changes.find((change) => !isChange(change));
      if (invalid !== undefined) return { id: c.id, problems: [`not a change of stage-contract.md: ${JSON.stringify(invalid)}`], folder, rounds: round };
      const changes = parsed.changes.filter(isChange);
      try {
        applyChanges(crux, changes);
      } catch (error) {
        return { id: c.id, problems: [`changes did not apply: ${(error as Error).message}`], folder, rounds: round };
      }
      const newErrors = errors(validate(crux)).filter((e) => !before.has(`${e.path}: ${e.message}`));
      const problems = [...(notBare ? [NOT_BARE] : []), ...c.check({ approvedSummary: String(parsed.approvedSummary ?? ""), changes, asked, crux, newErrors })];
      return { id: c.id, problems, folder, rounds: round };
    }
    if (!Array.isArray(parsed.questions)) return { id: c.id, problems: ["the reply is neither questions nor changes"], folder, rounds: round };
    asked.push(typeof parsed.draft === "string" ? parsed.draft : JSON.stringify(parsed.draft ?? ""));
    const answers = [];
    for (const q of parsed.questions) {
      const text = `${q.question} ${(q.options ?? []).join(" ")}`;
      asked.push(text);
      const answer = answerFor(text, c.answers, used);
      if (answer === undefined) return { id: c.id, problems: [`no answer for: ${q.question}`], folder, rounds: round };
      answers.push({ id: q.id, answer });
    }
    message = JSON.stringify({ answers });
  }
  return { id: c.id, problems: [`still open after ${MAX_ROUNDS} rounds`], folder, rounds: MAX_ROUNDS };
}

async function runCritic(c: CriticCase | null): Promise<Outcome> {
  const id = c ? `critic-${c.id}` : "critic-clean";
  const folder = join(sandboxRoot, id);
  const checkout = join(folder, "shop");
  mkdirSync(checkout, { recursive: true });
  writeCheckout(checkout);
  const crux = join(checkout, ".crux");
  cpSync(join(ROOT, "tests/fixtures/generic/.crux"), crux, { recursive: true, verbatimSymlinks: true });
  c?.mutate(crux);
  const launch = { stage: "S12", configContext: contextOf("jira", c?.wiki), checkout, package: crux, approvedSummaries: {}, edit: null, paths: null, references };
  const reply = await turn("config-critic", checkout, JSON.stringify(launch));
  const { value, strict } = parseReply(reply.text);
  const parsed = value as { findings?: { stage?: string; path?: string; check?: string; message?: string }[] };
  writeFileSync(join(folder, "replies.json"), `${JSON.stringify(parsed, null, 2)}\n`);
  if (!Array.isArray(parsed.findings)) return { id, problems: ["the reply has no findings list"], folder, rounds: 1 };
  if (c === null) {
    // The generic package breaks nothing: what the critic finds here is reported, not failed.
    console.log(`  ${id}: ${parsed.findings.length} finding(s) on the clean package${parsed.findings.map((f) => `\n    · ${f.check} ${f.path}: ${f.message}`).join("")}`);
    return { id, problems: strict ? [] : [NOT_BARE], folder, rounds: 1 };
  }
  const hit = parsed.findings.some((f) => f.check === c.check && f.stage === c.stage);
  const got = parsed.findings.map((f) => `${f.check}@${f.stage} ${f.path}`).join("; ") || "none";
  const problems = [...(strict ? [] : [NOT_BARE]), ...(hit ? [] : [`no ${c.check} finding in ${c.stage} (got: ${got})`])];
  return { id, problems, folder, rounds: 1 };
}

// ---------------------------------------------------------------------------

const stageCases = STAGE_CASES.filter(
  (c) =>
    (target === "all" || target === c.stage) &&
    (values.tracker === undefined || values.tracker === c.tracker) &&
    (values.case === undefined || values.case === c.id),
);
const criticCases: (CriticCase | null)[] =
  target === "all" || target === "critic" ? [null, ...CRITIC_CASES].filter((c) => values.case === undefined || values.case === (c ? c.id : "clean")) : [];
const jobs: (() => Promise<Outcome>)[] = [...stageCases.map((c) => () => runStage(c)), ...criticCases.map((c) => () => runCritic(c))];
if (jobs.length === 0) {
  console.error(`usage: bun tests/harness/stages.ts [${[...new Set(STAGE_CASES.map((c) => c.stage))].join("|")}|critic|all] [--tracker <kind>] [--case <id>]`);
  process.exit(2);
}

console.log(`# crux-config stage runs: ${jobs.length} case(s), model ${values.ollama ? `ollama:${values.ollama}` : values.model}`);
console.log(`sandbox: ${sandboxRoot}`);
const outcomes: Outcome[] = [];
const queue = [...jobs];
const ids = [...stageCases.map((c) => c.id), ...criticCases.map((c) => (c ? `critic-${c.id}` : "critic-clean"))];
await Promise.all(
  Array.from({ length: Math.max(1, Number(values.jobs)) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const index = jobs.indexOf(job);
      const outcome = await job().catch((error: Error) => ({ id: ids[index] ?? "?", problems: [error.message], folder: "", rounds: 0 }));
      outcomes.push(outcome);
      console.log(`${outcome.problems.length === 0 ? "PASS" : "FAIL"} ${outcome.id} (${outcome.rounds} round(s))${outcome.problems.map((p) => `\n  - ${p}`).join("")}`);
    }
  }),
);
const failed = outcomes.filter((o) => o.problems.length > 0);
console.log(`\n${outcomes.length - failed.length}/${outcomes.length} passed${failed.length ? `; failed: ${failed.map((o) => o.id).join(", ")}` : ""}`);
process.exit(failed.length === 0 ? 0 : 1);
