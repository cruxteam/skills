/**
 * The stage harness's deterministic parts (CF-14): read a stage agent's JSON reply, answer its
 * questions from a fixture, and apply its `changes` to a `.crux/` folder the way
 * `references/package-format.md` (*Changes*) says, so `validate.mjs` can check the result.
 * `tests/stage-lib.test.ts` covers it; `stages.ts` uses it.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export type Answer = { question: string; answer: string };

export type Change =
  | { op: "set"; path: string; value: unknown }
  | { op: "add"; kind: string; name: string; value: unknown }
  | { op: "remove"; kind: string; name: string }
  | { op: "rename"; kind: string; from: string; to: string };

type Doc = Record<string, unknown>;

export type Issue = { severity: string; path: string; message: string };

/** The `config_context` fixture folder of each tracker shape, under `tests/fixtures/tools/`. */
export const CONTEXTS = { jira: "new-project", plane: "plane", linear: "linear", github: "github" } as const;

const VALIDATOR = join(import.meta.dir, "../../skills/crux-config/scripts/validate.mjs");

/** `validate.mjs --json` on a `.crux/` folder; throws when the validator does not answer JSON. */
export function validatePackage(crux: string): { valid: boolean; issues: Issue[] } {
  const proc = Bun.spawnSync(["bun", VALIDATOR, "--json", crux]);
  try {
    return JSON.parse(proc.stdout.toString());
  } catch {
    throw new Error(`validator failed (exit ${proc.exitCode}): ${proc.stderr.toString().trim().slice(0, 400)}`);
  }
}

/**
 * The one JSON object of a reply: bare, fenced, or with prose around it. `strict` says it was bare,
 * as `stage-contract.md` asks; the caller reports a reply that was not.
 */
export function parseReply(text: string): { value: object; strict: boolean } {
  const candidates = [text.trim(), text.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/)?.[1], sliceObject(text)];
  for (const [at, candidate] of candidates.entries()) {
    if (candidate === undefined) continue;
    try {
      const value = JSON.parse(candidate);
      if (typeof value === "object" && value !== null && !Array.isArray(value)) return { value, strict: at === 0 };
    } catch {
      // try the next shape
    }
  }
  throw new Error(`no JSON object in the reply: ${text.slice(0, 200)}`);
}

const sliceObject = (text: string) => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start === -1 || end <= start ? undefined : text.slice(start, end + 1);
};

/** The first unused entry whose `question` occurs in `question` (ignoring case); `*` matches all, never used up. */
export function answerFor(question: string, answers: Answer[], used: Set<number>): string | undefined {
  const asked = question.toLowerCase();
  const at = answers.findIndex((a, n) => a.question !== "*" && !used.has(n) && asked.includes(a.question.toLowerCase()));
  if (at !== -1) {
    used.add(at);
    return answers[at]?.answer;
  }
  return answers.find((a) => a.question === "*")?.answer;
}

/** Applies `changes` in order to the `.crux/` folder `crux`. */
export function applyChanges(crux: string, changes: Change[]): void {
  for (const change of changes) {
    if (change.op === "set") set(crux, change.path, change.value);
    else if (change.op === "add") add(crux, change.kind, change.name, change.value);
    else if (change.op === "remove") remove(crux, change.kind, change.name);
    else if (change.op === "rename") throw new Error("rename is not applied by the harness");
    else throw new Error(`unknown op: ${JSON.stringify(change)}`);
  }
}

/** Whether `x` has the fields its `op` needs (`stage-contract.md`, the `changes` of an answer). */
export function isChange(x: unknown): x is Change {
  if (typeof x !== "object" || x === null) return false;
  const change = x as Record<string, unknown>;
  const text = (key: string) => typeof change[key] === "string";
  switch (change.op) {
    case "set":
      return text("path") && "value" in change;
    case "add":
      return text("kind") && text("name") && "value" in change;
    case "remove":
      return text("kind") && text("name");
    case "rename":
      return text("kind") && text("from") && text("to");
    default:
      return false;
  }
}

/** `rel` under `base`; throws for an absolute path or one that climbs out of `base`. */
function inside(base: string, rel: string): string {
  const path = resolve(base, rel);
  if (isAbsolute(rel) || !path.startsWith(base + sep)) throw new Error(`path escapes the package: ${rel}`);
  return path;
}

function set(crux: string, path: string, value: unknown) {
  const hash = path.indexOf("#");
  if (hash === -1) return writeText(inside(crux, path), String(value));
  const file = path.slice(0, hash);
  const field = path.slice(hash + 1);
  if (file === "ADVISORS.md" && field === "Context") return setContext(crux, String(value));
  const doc = readYaml(crux, file);
  const keys = field.split(".");
  const last = keys.pop() as string;
  let at: Doc = doc;
  for (const key of keys) {
    if (typeof at[key] !== "object" || at[key] === null) at[key] = {};
    at = at[key] as Doc;
  }
  if (value === null) delete at[last];
  else at[last] = value;
  writeYaml(crux, file, doc);
}

function setContext(crux: string, body: string) {
  const path = join(crux, "ADVISORS.md");
  const text = existsSync(path) ? readFileSync(path, "utf8") : "# Shared rules\n";
  const section = `## Context\n\n${body.trim()}\n`;
  const start = text.indexOf("## Context\n");
  if (start !== -1) {
    // S1 owns the section up to the next heading or S10's principles (`package-format.md`, `ADVISORS.md`).
    const after = text.slice(start + "## Context\n".length);
    const end = after.search(/\n(?=## |Every agent of this workflow follows these principles\.|1\. One agent, one responsibility\.)/);
    const tail = end === -1 ? "" : `\n${after.slice(end + 1)}`;
    return writeText(path, `${text.slice(0, start)}${section}${tail}`);
  }
  const rest = text.replace(/^# Shared rules\n+/, "");
  writeText(path, `# Shared rules\n\n${section}\n${rest}`);
}

function add(crux: string, kind: string, name: string, value: unknown) {
  switch (kind) {
    case "role":
    case "flow": {
      const doc = readYaml(crux, "workflow.yaml");
      const key = kind === "role" ? "roles" : "roleFlows";
      doc[key] = { ...(doc[key] as Doc | undefined), [name]: value };
      return writeYaml(crux, "workflow.yaml", doc);
    }
    case "agent":
      for (const [file, text] of Object.entries(value as Record<string, string>)) {
        writeText(inside(inside(join(crux, "agents"), name), file), text);
      }
      return;
    case "level":
      return writeText(inside(join(crux, "levels"), `${name}.md`), String(value));
    case "attachment":
      return attach(crux, name, value as { skill?: string; server?: string });
    case "skill": {
      const skill = value as { source?: string; files?: Record<string, string> };
      const files = skill.files ?? {
        "SKILL.md": `---\nname: ${name}\ndescription: Stand-in for ${skill.source} in the stage harness.\n---\n\nStand-in.\n`,
      };
      for (const [file, text] of Object.entries(files)) writeText(inside(inside(join(crux, "skills"), name), file), text);
      return index(crux, "skills", skill.source === undefined ? { name } : { name, source: skill.source });
    }
    case "server":
      writeText(inside(join(crux, "mcp"), `${name}.json`), JSON.stringify(value, null, 2));
      return index(crux, "mcpServers", { name });
    default:
      throw new Error(`unknown add kind: ${kind}`);
  }
}

function attach(crux: string, agent: string, target: { skill?: string; server?: string }) {
  const yamlFile = `agents/${agent}/agent.yaml`;
  const meta = readYaml(crux, yamlFile);
  if (target.skill !== undefined && meta.runtime === "WORKER") {
    meta.skills = [...new Set([...((meta.skills as string[] | undefined) ?? []), target.skill])];
    return writeYaml(crux, yamlFile, meta);
  }
  if (target.skill === undefined && target.server === undefined) throw new Error("an attachment names a skill or a server");
  const [folder, file] = target.skill !== undefined ? ["skills", target.skill] : ["mcp", `${target.server}.json`];
  inside(join(crux, folder), file);
  const link = join(inside(join(crux, "agents"), agent), folder, file);
  mkdirSync(dirname(link), { recursive: true });
  // lstat, not exists: a link made before its target is dangling, and still there.
  if (!lstatSync(link, { throwIfNoEntry: false })) symlinkSync(`../../../${folder}/${file}`, link);
}

function index(crux: string, key: "skills" | "mcpServers", entry: { name: string; source?: string }) {
  const doc = readYaml(crux, "workflow.yaml");
  const list = ((doc[key] as { name: string }[] | undefined) ?? []).filter((e) => e.name !== entry.name);
  doc[key] = [...list, entry].sort((a, b) => a.name.localeCompare(b.name));
  writeYaml(crux, "workflow.yaml", doc);
}

function remove(crux: string, kind: string, name: string) {
  const doc = readYaml(crux, "workflow.yaml");
  if (kind === "agent") {
    rmSync(inside(join(crux, "agents"), name), { recursive: true, force: true });
    for (const flow of Object.values((doc.roleFlows as Record<string, Record<string, string[]>> | undefined) ?? {})) {
      for (const lane of ["pipeline", "chatAgents"]) {
        if (flow[lane]) flow[lane] = flow[lane].filter((n) => n !== name);
      }
    }
  } else if (kind === "level") {
    rmSync(inside(join(crux, "levels"), `${name}.md`), { force: true });
  } else if (kind === "role" || kind === "flow") {
    delete ((doc[kind === "role" ? "roles" : "roleFlows"] as Doc | undefined) ?? {})[name];
  } else if (kind === "skill" || kind === "server" || kind === "attachment") {
    throw new Error(`remove ${kind} is not applied by the harness`);
  } else {
    throw new Error(`unknown remove kind: ${kind}`);
  }
  writeYaml(crux, "workflow.yaml", doc);
}

const readYaml = (crux: string, file: string): Doc => {
  const path = inside(crux, file);
  return existsSync(path) ? ((Bun.YAML.parse(readFileSync(path, "utf8")) as Doc | null) ?? {}) : {};
};

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys((value as Doc)[key])]),
  );
};

const writeYaml = (crux: string, file: string, doc: Doc) =>
  writeText(
    inside(crux, file),
    Bun.YAML.stringify(sortKeys(doc), null, 2)
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n"),
  );

/** Writes `text` with exactly one final newline, LF only. */
export function writeText(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${text.replace(/\r\n/g, "\n").replace(/\n+$/, "")}\n`);
}
