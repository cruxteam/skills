/**
 * The stage cases of the CF-14 harness (`stages.ts`): per case, the tracker context, the starting
 * `.crux/`, the earlier stages' summaries, the answers a person gives and the checks on what the
 * stage agent returned. Answers are facts, not scripts: a `*` entry states everything the person
 * would say, so any wording of the agent's questions finds its answer.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Answer, applyChanges, type Change, type CONTEXTS, type Issue } from "./stage-lib";

export type Tracker = keyof typeof CONTEXTS;
export type { Issue };
export type Stage = "product" | "roles" | "statuses" | "levels" | "estimates" | "pipeline" | "chat" | "skills" | "mcp" | "rules" | "retro";

export type StageResult = {
  approvedSummary: string;
  changes: Change[];
  /** Every question and draft the agent sent, in order. */
  asked: string[];
  /** The package after the changes were applied. */
  crux: string;
  /** Validator errors the changes introduced (not present in the seed). */
  newErrors: Issue[];
};
export type StageCase = {
  id: string;
  stage: Stage;
  tracker: Tracker;
  seed: (crux: string) => void;
  summaries?: Record<string, string>;
  answers: Answer[];
  check: (result: StageResult) => string[];
};

const GENERIC = join(import.meta.dir, "../fixtures/generic/.crux");
const genericYaml = () => Bun.YAML.parse(readFileSync(join(GENERIC, "workflow.yaml"), "utf8")) as Record<string, any>;

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

/** No `.crux/` yet: the orchestrator's first write creates the minimal workflow.yaml. */
const fresh = (crux: string) => rmSync(crux, { recursive: true, force: true });
const minimal = (crux: string) => {
  fresh(crux);
  applyChanges(crux, [
    { op: "set", path: "workflow.yaml#name", value: "Shop workflow" },
    { op: "set", path: "workflow.yaml#roleFlows", value: {} },
    { op: "set", path: "workflow.yaml#roles", value: {} },
    { op: "set", path: "workflow.yaml#version", value: "5" },
  ]);
};
const withRoles = (crux: string) => {
  minimal(crux);
  applyChanges(crux, [{ op: "set", path: "workflow.yaml#roles", value: genericYaml().roles }]);
};
const generic = (crux: string) => {
  fresh(crux);
  cpSync(GENERIC, crux, { recursive: true, verbatimSymlinks: true });
};
/** The generic package without agents: S1–S5 done, S6 next. */
const withoutAgents = (crux: string) => {
  generic(crux);
  for (const agent of readdirSync(join(crux, "agents"))) rmSync(join(crux, "agents", agent), { recursive: true });
  const flows = genericYaml().roleFlows as Record<string, Record<string, unknown>>;
  applyChanges(
    crux,
    Object.keys(flows).flatMap((status) => [
      { op: "set" as const, path: `workflow.yaml#roleFlows.${status}.pipeline`, value: [] },
      { op: "set" as const, path: `workflow.yaml#roleFlows.${status}.chatAgents`, value: [] },
    ]),
  );
};
const withoutChat = (crux: string) => {
  generic(crux);
  applyChanges(crux, [{ op: "remove", kind: "agent", name: "status-reporter" }]);
};

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------

const setOf = (r: StageResult, path: string) => r.changes.find((c) => c.op === "set" && c.path === path) as
  | { value: unknown }
  | undefined;
const addsOf = (r: StageResult, kind: string) =>
  r.changes.filter((c): c is Extract<Change, { op: "add" }> => c.op === "add" && c.kind === kind);
const workflow = (r: StageResult) => Bun.YAML.parse(readFileSync(join(r.crux, "workflow.yaml"), "utf8")) as Record<string, any>;
const fileOf = (r: StageResult, rel: string) => {
  try {
    return readFileSync(join(r.crux, rel), "utf8");
  } catch {
    return "";
  }
};
const yamlOf = (r: StageResult, rel: string) => (Bun.YAML.parse(fileOf(r, rel)) ?? {}) as Record<string, any>;
const levelNames = (r: StageResult) => {
  try {
    return readdirSync(join(r.crux, "levels")).map((f) => f.replace(/\.md$/, "")).sort();
  } catch {
    return [];
  }
};
const said = (r: StageResult, pattern: RegExp) => r.asked.some((text) => pattern.test(text)) || pattern.test(r.approvedSummary);

const expect = (problems: string[], ok: boolean, problem: string) => {
  if (!ok) problems.push(problem);
};
const noNewErrors = (r: StageResult, problems: string[]) => {
  for (const e of r.newErrors) problems.push(`validator: ${e.path}: ${e.message}`);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const ROLE_COLORS = ["#8079f0", "#4cc5b5", "#e3b25c", "#e07ab0", "#5f9bf0", "#5cc28a", "#e9736a"];
const ROLE_ICONS = ["crown", "code", "clipboard-list", "palette", "bug", "shield", "rocket", "users"];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** S3: the flows, their groups and roles, and the entry flow. */
function flowsCheck(expected: Record<string, [group: string, role: string]>, entry: string) {
  return (r: StageResult) => {
    const problems: string[] = [];
    const flows = (workflow(r).roleFlows ?? {}) as Record<string, Record<string, unknown>>;
    expect(problems, same(Object.keys(flows).sort(), Object.keys(expected).sort()), `flows ${Object.keys(flows).join(", ")} ≠ ${Object.keys(expected).join(", ")}`);
    for (const [status, [group, role]] of Object.entries(expected)) {
      const flow = flows[status];
      if (!flow) continue;
      expect(problems, flow.expectedGroup === group, `${status}: expectedGroup ${String(flow.expectedGroup)} ≠ ${group}`);
      expect(problems, flow.role === role, `${status}: role ${String(flow.role)} ≠ ${role}`);
      expect(problems, same(flow.pipeline, []) && same(flow.chatAgents, []), `${status}: lanes are not empty`);
    }
    expect(problems, workflow(r).entryFlow === entry, `entryFlow ${String(workflow(r).entryFlow)} ≠ ${entry}`);
    noNewErrors(r, problems);
    return problems;
  };
}

/** S4: exactly these levels, each with a description and a structure. */
function levelsCheck(names: string[], extra?: (r: StageResult, problems: string[]) => void) {
  return (r: StageResult) => {
    const problems: string[] = [];
    expect(problems, same(levelNames(r), [...names].sort()), `levels ${levelNames(r).join(", ")} ≠ ${names.join(", ")}`);
    for (const name of levelNames(r)) {
      const text = fileOf(r, `levels/${name}.md`);
      expect(problems, text.includes("## Description") && text.includes("## Structure"), `levels/${name}.md lacks ## Description or ## Structure`);
    }
    extra?.(r, problems);
    noNewErrors(r, problems);
    return problems;
  };
}

/** S5: `estimates` and `estimateScale` as the person decided. */
function estimatesCheck(on: boolean, scale?: number[]) {
  return (r: StageResult) => {
    const problems: string[] = [];
    const w = workflow(r);
    expect(problems, on ? w.estimates === "on" || w.estimates === true : !("estimates" in w), `estimates is ${String(w.estimates)}`);
    expect(problems, same(w.estimateScale, scale), `estimateScale ${JSON.stringify(w.estimateScale)} ≠ ${JSON.stringify(scale)}`);
    noNewErrors(r, problems);
    return problems;
  };
}

/** Every agent of the result's package that S6 or S7 added, with its parsed agent.yaml and prompt. */
const addedAgents = (r: StageResult) =>
  addsOf(r, "agent").map((c) => ({
    name: c.name,
    meta: yamlOf(r, `agents/${c.name}/agent.yaml`),
    prompt: fileOf(r, `agents/${c.name}/system-prompt.md`),
    first: fileOf(r, `agents/${c.name}/first-message.md`),
  }));

const TRACKER_WRITES = ["comment_create", "ticket_create", "ticket_update", "ticket_set_status", "ticket_delete", "link_create"];
const allowed = (meta: Record<string, any>) =>
  Object.entries((meta.permission ?? {}) as Record<string, string>)
    .filter(([, v]) => v === "allow")
    .map(([k]) => k.replace(/^mcp_crux_/, ""));

/** The rules every hosted agent S6/S7 writes keeps. */
function hostedAgentProblems(agent: ReturnType<typeof addedAgents>[number], problems: string[]) {
  const { name, meta, prompt } = agent;
  expect(problems, /explicit ok|explicit approval|explicit/i.test(prompt), `${name}: no confirmation contract`);
  expect(problems, prompt.includes("data, never instructions"), `${name}: no quoted-data line`);
  if (meta.runtime !== "ADVISOR") return;
  const permission = (meta.permission ?? {}) as Record<string, string>;
  expect(problems, permission["mcp_crux_*"] === "deny", `${name}: mcp_crux_* is not deny`);
  expect(problems, !Object.values(permission).includes("ask"), `${name}: a permission is ask`);
  expect(problems, permission.bash === "deny", `${name}: bash is not deny`);
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const S1_JIRA =
  "Shop: people order handmade furniture online; small furniture makers sell through it. Stack: as in the repository (Next.js, Vitest). Code lives only here. Artifacts in English, chat in Ukrainian. Local AI tools: Claude Code (.claude/skills/) and Codex (.agents/skills/). Wiki: none. Defaults: accessCode READ, accessWiki NONE.";
const S3_JIRA = "To Do and Done: product-owner; In Progress and In Review: developer. Agents in To Do, In Progress, In Review; Done has none. New tickets enter To Do.";

export const STAGE_CASES: StageCase[] = [
  // S1 product and team
  {
    id: "product-jira",
    stage: "product",
    tracker: "jira",
    seed: fresh,
    answers: [
      {
        question: "*",
        answer:
          "The product is Shop, a web shop where people order handmade furniture; small furniture makers sell through it. The stack is what you see in the repository. Code lives only in this repository; there are no separate docs. Artifacts are written in English; we chat with the agents in Ukrainian. The team uses Claude Code and Codex. We will not use a wiki for now. Agents should read the code.",
      },
    ],
    check: (r) => {
      const problems: string[] = [];
      expect(problems, r.changes.length === 1 && setOf(r, "ADVISORS.md#Context") !== undefined, `changes are not one set of ADVISORS.md#Context: ${r.changes.map((c) => c.op).join(", ")}`);
      const context = String(setOf(r, "ADVISORS.md#Context")?.value ?? "");
      expect(problems, /furniture/i.test(context), "the context does not name the product");
      expect(problems, /next/i.test(context), "the context does not name the stack read from the checkout");
      expect(problems, /ukrainian/i.test(context + r.approvedSummary), "the chat language is missing");
      expect(problems, /claude code/i.test(r.approvedSummary) && /codex/i.test(r.approvedSummary), "the summary lacks the local AI tools");
      expect(problems, /\.claude\/skills/.test(r.approvedSummary) && /\.agents\/skills/.test(r.approvedSummary), "the summary lacks the skill folders");
      expect(problems, /accessCode\W+READ/i.test(r.approvedSummary), "the summary lacks accessCode READ");
      expect(problems, said(r, /dashboard/i) || /wiki\W+none/i.test(r.approvedSummary), "the wiki offer is missing");
      return problems;
    },
  },
  {
    id: "product-plane-wiki",
    stage: "product",
    tracker: "plane",
    seed: fresh,
    answers: [
      {
        question: "*",
        answer:
          "Shop is a web shop for handmade furniture. The stack is what you see in the repository. The docs live in the wiki repository that is already bound. Everything is in English. The team uses Claude Code only. Agents should read both the code and the wiki.",
      },
    ],
    check: (r) => {
      const problems: string[] = [];
      expect(problems, setOf(r, "ADVISORS.md#Context") !== undefined, "no ADVISORS.md#Context");
      expect(problems, /wiki\W+bound/i.test(r.approvedSummary), "the summary does not say the wiki is bound");
      expect(problems, /accessWiki\W+READ/i.test(r.approvedSummary), "the summary lacks accessWiki READ");
      return problems;
    },
  },
  // S2 roles
  {
    id: "roles-jira",
    stage: "roles",
    tracker: "jira",
    seed: minimal,
    summaries: { S1: S1_JIRA },
    answers: [
      {
        question: "*",
        answer:
          "We have a product owner who writes and accepts requests, developers who build and review changes, a QA tester who checks releases, and a Дизайнер who draws the screens (keep that title as it is). The slugs, colours and icons you generate are fine.",
      },
    ],
    check: (r) => {
      const problems: string[] = [];
      const roles = (setOf(r, "workflow.yaml#roles")?.value ?? {}) as Record<string, Record<string, string>>;
      expect(problems, Object.keys(roles).length === 4, `${Object.keys(roles).length} roles, not 4`);
      for (const [key, role] of Object.entries(roles)) {
        expect(problems, role.slug === key && KEBAB.test(key), `role ${key}: slug ${role.slug} is not its kebab key`);
        expect(problems, ROLE_COLORS.includes(role.color ?? ""), `role ${key}: colour ${role.color} is off the palette`);
        expect(problems, ROLE_ICONS.includes(role.icon ?? ""), `role ${key}: icon ${role.icon} is not a dashboard icon`);
      }
      const designer = Object.values(roles).find((role) => role.title === "Дизайнер");
      expect(problems, designer !== undefined, "no role titled Дизайнер");
      if (designer) expect(problems, said(r, new RegExp(`\\b${designer.slug}\\b`)), "the designer's slug was never shown");
      noNewErrors(r, problems);
      return problems;
    },
  },
  // S3 statuses ↔ roles
  {
    id: "statuses-jira",
    stage: "statuses",
    tracker: "jira",
    seed: withRoles,
    summaries: { S1: S1_JIRA, S2: "product-owner (writes and accepts requests), developer (builds and reviews changes)." },
    answers: [
      {
        question: "*",
        answer:
          "To Do and Done belong to the product owner; In Progress and In Review to the developer. Agents work in To Do, In Progress and In Review; Done has no agents. New tickets enter To Do.",
      },
    ],
    check: flowsCheck(
      { "To Do": ["unstarted", "product-owner"], "In Progress": ["started", "developer"], "In Review": ["started", "developer"], Done: ["completed", "product-owner"] },
      "To Do",
    ),
  },
  {
    id: "statuses-jira-shared",
    stage: "statuses",
    tracker: "jira",
    seed: withRoles,
    summaries: { S1: S1_JIRA, S2: "product-owner (writes and accepts requests), developer (builds and reviews changes)." },
    answers: [
      { question: "which role", answer: "The developer's agents run in In Review." },
      {
        question: "*",
        answer:
          "To Do and Done belong to the product owner; In Progress to the developer. In In Review both work: developers review the code there and the product owner accepts the change. Done has no agents. New tickets enter To Do.",
      },
    ],
    check: (r) => {
      const problems = flowsCheck(
        { "To Do": ["unstarted", "product-owner"], "In Progress": ["started", "developer"], "In Review": ["started", "developer"], Done: ["completed", "product-owner"] },
        "To Do",
      )(r);
      expect(problems, said(r, /which role/i), "the agent never asked which role's agents run in the shared status");
      return problems;
    },
  },
  {
    id: "statuses-plane",
    stage: "statuses",
    tracker: "plane",
    seed: withRoles,
    answers: [
      {
        question: "*",
        answer:
          "Backlog and Todo belong to the product owner, In Progress to the developer; Done and Cancelled belong to the product owner and have no agents. New work items enter Backlog.",
      },
    ],
    check: flowsCheck(
      {
        Backlog: ["backlog", "product-owner"],
        Todo: ["unstarted", "product-owner"],
        "In Progress": ["started", "developer"],
        Done: ["completed", "product-owner"],
        Cancelled: ["cancelled", "product-owner"],
      },
      "Backlog",
    ),
  },
  {
    id: "statuses-linear",
    stage: "statuses",
    tracker: "linear",
    seed: withRoles,
    answers: [
      {
        question: "*",
        answer:
          "Backlog, Todo, Done and Canceled belong to the product owner; In Progress and In Review to the developer. Done and Canceled have no agents. New issues enter Backlog.",
      },
    ],
    check: flowsCheck(
      {
        Backlog: ["backlog", "product-owner"],
        Todo: ["unstarted", "product-owner"],
        "In Progress": ["started", "developer"],
        "In Review": ["started", "developer"],
        Done: ["completed", "product-owner"],
        Canceled: ["cancelled", "product-owner"],
      },
      "Backlog",
    ),
  },
  {
    id: "statuses-github",
    stage: "statuses",
    tracker: "github",
    seed: withRoles,
    answers: [
      {
        question: "*",
        answer:
          "Our statuses, in order: Backlog, In progress, Review, Done. Backlog is in the backlog group, In progress and Review are started, Done is completed. Backlog and Done belong to the product owner, In progress and Review to the developer. Done has no agents. New issues enter Backlog.",
      },
    ],
    check: (r) => {
      const problems = flowsCheck(
        { Backlog: ["backlog", "product-owner"], "In progress": ["started", "developer"], Review: ["started", "developer"], Done: ["completed", "product-owner"] },
        "Backlog",
      )(r);
      expect(problems, said(r, /S:/), "the S: labels activation creates were never mentioned");
      return problems;
    },
  },
  // S4 levels
  {
    id: "levels-jira",
    stage: "levels",
    tracker: "jira",
    seed: withRoles,
    answers: [{ question: "*", answer: "Use the tracker's issue types with the stock texts, and add a Spike for time-boxed investigations." }],
    check: levelsCheck(["Bug", "Spike", "Story", "Task"], (r, problems) => {
      expect(problems, /acceptance criteria/i.test(fileOf(r, "levels/Story.md")), "Story lost the stock acceptance criteria");
      expect(problems, said(r, /LV:/), "Spike's LV: label was never mentioned");
    }),
  },
  {
    id: "levels-plane",
    stage: "levels",
    tracker: "plane",
    seed: withRoles,
    answers: [{ question: "*", answer: "Use the stock levels with their stock texts." }],
    check: levelsCheck(["Bug", "Epic", "Story", "Task"]),
  },
  {
    id: "levels-linear",
    stage: "levels",
    tracker: "linear",
    seed: withRoles,
    answers: [{ question: "*", answer: "We only use Task and Bug, with the stock texts." }],
    check: levelsCheck(["Bug", "Task"]),
  },
  {
    id: "levels-github",
    stage: "levels",
    tracker: "github",
    seed: withRoles,
    answers: [{ question: "*", answer: "Use the three issue types with the stock texts." }],
    check: levelsCheck(["Bug", "Feature", "Task"], (r, problems) => {
      expect(problems, /feature/i.test(fileOf(r, "levels/Feature.md").split("## Structure")[0] ?? ""), "Feature's description does not name it");
    }),
  },
  // S5 estimates
  {
    id: "estimates-jira",
    stage: "estimates",
    tracker: "jira",
    seed: withRoles,
    answers: [{ question: "*", answer: "Yes, we estimate in story points." }],
    check: estimatesCheck(true),
  },
  {
    id: "estimates-plane",
    stage: "estimates",
    tracker: "plane",
    seed: withRoles,
    answers: [{ question: "*", answer: "Yes, we estimate, with the scale 1, 2, 4, 8." }],
    check: estimatesCheck(true, [1, 2, 4, 8]),
  },
  {
    id: "estimates-linear",
    stage: "estimates",
    tracker: "linear",
    seed: withRoles,
    answers: [{ question: "*", answer: "No, we do not estimate." }],
    check: estimatesCheck(false),
  },
  {
    id: "estimates-github",
    stage: "estimates",
    tracker: "github",
    seed: withRoles,
    answers: [{ question: "*", answer: "Yes, we estimate; use 1, 2, 3, 5, 8, 13." }],
    check: estimatesCheck(true, [1, 2, 3, 5, 8, 13]),
  },
  // S6 pipeline agents
  {
    id: "pipeline-jira",
    stage: "pipeline",
    tracker: "jira",
    seed: withoutAgents,
    summaries: { S1: S1_JIRA, S3: S3_JIRA },
    answers: [
      {
        question: "*",
        answer:
          "In To Do a refiner turns the request into acceptance criteria, asking me questions one at a time. In In Progress a planner reads the code and writes an implementation plan from the criteria, then a builder writes the code on a branch and opens a pull request; the builder runs on our machines. In In Review a reviewer checks the change against the criteria and the plan and writes a review-report; the reviewer is hosted and only reads the code — only the builder runs on our machines. Use anthropic with your default model. Human gates as you propose: I approve each artifact before it is posted, and the builder at merge. No agent moves statuses. Keep chats 7 days. The names and artifacts you propose are fine.",
      },
    ],
    check: (r) => {
      const problems: string[] = [];
      const agents = addedAgents(r);
      const flows = workflow(r).roleFlows as Record<string, { pipeline: string[] }>;
      expect(problems, flows["To Do"]?.pipeline.length === 1, `To Do pipeline: ${flows["To Do"]?.pipeline.join(", ")}`);
      expect(problems, flows["In Progress"]?.pipeline.length === 2, `In Progress pipeline: ${flows["In Progress"]?.pipeline.join(", ")}`);
      expect(problems, flows["In Review"]?.pipeline.length === 1, `In Review pipeline: ${flows["In Review"]?.pipeline.join(", ")}`);
      expect(problems, same(flows.Done?.pipeline, []), "Done got agents");
      const workers = agents.filter((a) => a.meta.runtime === "WORKER").map((a) => a.name);
      expect(problems, same(workers, [flows["In Progress"]?.pipeline[1]]), `WORKER agents ${workers.join(", ")} ≠ the second In Progress agent`);
      const reviewer = agents.find((a) => a.name === flows["In Review"]?.pipeline[0]);
      expect(problems, reviewer?.meta.artifact === "review-report", `the reviewer's artifact is ${String(reviewer?.meta.artifact)}`);
      const artifacts = agents.map((a) => a.meta.artifact);
      expect(problems, new Set(artifacts).size === artifacts.length && artifacts.every((a) => KEBAB.test(String(a))), `artifacts not unique kebab: ${artifacts.join(", ")}`);
      for (const agent of agents) {
        hostedAgentProblems(agent, problems);
        expect(problems, agent.first.length > 0, `${agent.name}: no first-message.md`);
        expect(problems, agent.prompt.includes(String(agent.meta.artifact)) || agent.prompt.includes("{{agent.artifact}}"), `${agent.name}: the prompt does not name its artifact`);
        expect(problems, /gaps/i.test(agent.prompt), `${agent.name}: no Gaps section`);
        if (agent.meta.runtime !== "ADVISOR") continue;
        expect(problems, agent.meta.provider === "anthropic" && agent.meta.chatRetention === "D7", `${agent.name}: provider ${agent.meta.provider}, retention ${agent.meta.chatRetention}`);
        expect(problems, !allowed(agent.meta).includes("ticket_set_status"), `${agent.name}: may move statuses`);
        expect(problems, allowed(agent.meta).filter((t) => TRACKER_WRITES.includes(t)).length <= 1, `${agent.name}: more than one tracker-write tool`);
      }
      const planner = agents.find((a) => a.name === flows["In Progress"]?.pipeline[0]);
      const refiner = agents.find((a) => a.name === flows["To Do"]?.pipeline[0]);
      expect(problems, !!planner && !!refiner && planner.prompt.includes(String(refiner.meta.artifact)), "the planner does not read the refiner's artifact");
      noNewErrors(r, problems);
      return problems;
    },
  },
  {
    id: "pipeline-github-no-keys",
    stage: "pipeline",
    tracker: "github",
    seed: (crux) => {
      withRoles(crux);
      const flow = (role: string, expectedGroup: string) => ({ chatAgents: [], expectedGroup, pipeline: [], role });
      applyChanges(crux, [
        {
          op: "set",
          path: "workflow.yaml#roleFlows",
          value: {
            Backlog: flow("product-owner", "backlog"),
            "In progress": flow("developer", "started"),
            Review: flow("developer", "started"),
            Done: flow("product-owner", "completed"),
          },
        },
        { op: "set", path: "workflow.yaml#entryFlow", value: "Backlog" },
      ]);
    },
    summaries: { S1: S1_JIRA.replace("Wiki: none.", "Wiki: none. GitHub Issues without a Project.") },
    answers: [
      {
        question: "*",
        answer:
          "We have no LLM key yet, so only what runs on our machines. In In progress a builder writes the code on a branch and opens a pull request. In Review a reviewer checks the change and writes a review-report; when I tell it to, the reviewer moves the issue to Done. Backlog and Done have no agents. Your names and gates are fine.",
      },
    ],
    check: (r) => {
      const problems: string[] = [];
      expect(problems, said(r, /dashboard/i) && said(r, /commission/i), "no BYOK explanation (dashboard, no commission)");
      const agents = addedAgents(r);
      expect(problems, agents.length === 2, `${agents.length} agents, not 2`);
      expect(problems, agents.every((a) => a.meta.runtime === "WORKER"), "an agent is not a WORKER without a key");
      const flows = workflow(r).roleFlows as Record<string, { pipeline: string[] }>;
      const reviewer = agents.find((a) => a.name === flows.Review?.pipeline[0]);
      expect(problems, !!reviewer && /status|done/i.test(reviewer.prompt) && /tell|ask/i.test(reviewer.prompt), "the reviewer's prompt lacks the status move on the person's word");
      for (const agent of agents) hostedAgentProblems(agent, problems);
      noNewErrors(r, problems);
      return problems;
    },
  },
  // S7 chat agents
  {
    id: "chat-jira",
    stage: "chat",
    tracker: "jira",
    seed: withoutChat,
    summaries: { S1: S1_JIRA, S3: S3_JIRA },
    answers: [
      {
        question: "*",
        answer:
          "Yes: one helper, a status reporter for the product owner in To Do that assembles a progress update from the board and only reads. No other helpers. Your defaults for the model and retention are fine.",
      },
    ],
    check: (r) => {
      const problems: string[] = [];
      const agents = addedAgents(r);
      expect(problems, agents.length === 1, `${agents.length} chat agents, not 1`);
      const [agent] = agents;
      if (!agent) return problems;
      expect(problems, agent.meta.kind === "CHAT" && agent.first === "", `${agent.name}: kind ${agent.meta.kind}, first-message ${agent.first ? "present" : "absent"}`);
      expect(problems, allowed(agent.meta).every((t) => !TRACKER_WRITES.includes(t)), `${agent.name}: a read-only helper may write`);
      const lane = (workflow(r).roleFlows as Record<string, { chatAgents: string[] }>)["To Do"]?.chatAgents ?? [];
      expect(problems, lane.includes(agent.name), "the helper is not in To Do's chatAgents");
      hostedAgentProblems(agent, problems);
      noNewErrors(r, problems);
      return problems;
    },
  },
  // S8 skills
  {
    id: "skills-jira",
    stage: "skills",
    tracker: "jira",
    seed: generic,
    summaries: { S1: S1_JIRA },
    answers: [
      { question: "grill-me", answer: "Yes, add grill-me to the refiner." },
      { question: "reviewer", answer: "For the reviewer we want our own skill from GitLab: gitlab.com/acme/skills@house-review." },
      { question: "*", answer: "Take a skill you recommend only when it fits a hosted agent; otherwise skip it. Nothing else." },
    ],
    check: (r) => {
      const problems: string[] = [];
      const skills = addsOf(r, "skill");
      const grill = skills.find((s) => (s.value as { source?: string }).source === "mattpocock/skills@grill-me");
      expect(problems, grill !== undefined, "grill-me was not added from mattpocock/skills@grill-me");
      const refinerLinks = addsOf(r, "attachment").filter((a) => a.name === "refiner").map((a) => (a.value as { skill?: string }).skill);
      expect(problems, !!grill && refinerLinks.includes(grill.name), "grill-me is not attached to the refiner");
      expect(problems, !skills.some((s) => /gitlab/i.test(JSON.stringify(s.value))), "a GitLab source was added");
      expect(problems, said(r, /gitlab/i), "the GitLab source was never answered");
      const recorded = readFileSync(join(import.meta.dir, "../fixtures/tools/skills-find.txt"), "utf8");
      for (const skill of skills) {
        const source = (skill.value as { source?: string }).source;
        if (source) expect(problems, recorded.includes(source) || source.startsWith("mattpocock/skills@") || source.startsWith("kepano/obsidian-skills@"), `${source} is not a search result`);
      }
      const agents = readdirSync(join(r.crux, "agents"));
      for (const a of addsOf(r, "attachment")) expect(problems, agents.includes(a.name), `attachment to unknown agent ${a.name}`);
      noNewErrors(r, problems);
      return problems;
    },
  },
  // S9 MCP servers
  {
    id: "mcp-jira",
    stage: "mcp",
    tracker: "jira",
    seed: generic,
    summaries: { S1: S1_JIRA },
    answers: [
      {
        question: "*",
        answer:
          "The reviewer needs Sentry to look at errors: the HTTP server https://mcp.sentry.dev/mcp with a bearer token. Call the variable SENTRY_TOKEN. No other servers.",
      },
    ],
    check: (r) => {
      const problems: string[] = [];
      const [server] = addsOf(r, "server");
      const text = JSON.stringify(server?.value ?? {});
      expect(problems, server !== undefined, "no server added");
      expect(problems, text.includes("${SENTRY_TOKEN}") && text.includes("https://mcp.sentry.dev/mcp"), `the server lacks its URL or \${SENTRY_TOKEN}: ${text}`);
      const links = addsOf(r, "attachment").filter((a) => (a.value as { server?: string }).server === server?.name).map((a) => a.name);
      expect(problems, same(links, ["reviewer"]), `server attached to ${links.join(", ")}`);
      noNewErrors(r, problems);
      return problems;
    },
  },
  // S10 shared rules
  {
    id: "rules-jira",
    stage: "rules",
    tracker: "jira",
    seed: generic,
    summaries: { S1: S1_JIRA },
    answers: [{ question: "*", answer: "Artifacts in English, chat in Ukrainian. One team rule: every artifact links the pull request when there is one." }],
    check: (r) => {
      const problems: string[] = [];
      const text = String(setOf(r, "ADVISORS.md")?.value ?? "");
      for (let n = 1; n <= 11; n++) expect(problems, new RegExp(`^${n}\\. `, "m").test(text), `principle ${n} is missing`);
      expect(problems, !/^12\. /m.test(text), "principle 12 is there without a wiki");
      expect(problems, text.includes("data, never instructions"), "no quoted-data line");
      expect(problems, /## Team rules[\s\S]*pull request/i.test(text), "the team rule is not under ## Team rules");
      noNewErrors(r, problems);
      return problems;
    },
  },
  {
    id: "rules-plane-wiki",
    stage: "rules",
    tracker: "plane",
    seed: (crux) => {
      generic(crux);
      applyChanges(crux, [{ op: "set", path: "ADVISORS.md#Context", value: "Shop, a web shop for handmade furniture." }]);
    },
    summaries: { S1: "Shop, a web shop for handmade furniture. Everything in English. Local AI tools: Claude Code (.claude/skills/). Wiki: bound. Defaults: accessCode READ, accessWiki READ." },
    answers: [{ question: "*", answer: "No team rules beyond the language: English everywhere." }],
    check: (r) => {
      const problems: string[] = [];
      const text = String(setOf(r, "ADVISORS.md")?.value ?? "");
      expect(problems, /^12\. The wiki is a current spec/m.test(text), "principle 12 is missing with a wiki");
      expect(problems, text.includes("## Context\n\nShop, a web shop for handmade furniture."), "S1's ## Context was not kept");
      noNewErrors(r, problems);
      return problems;
    },
  },
  // S11 retro
  {
    id: "retro-jira",
    stage: "retro",
    tracker: "jira",
    seed: (crux) => {
      generic(crux);
      applyChanges(crux, [{ op: "add", kind: "level", name: "Defect", value: "## Description\n\nA defect found in production.\n\n## Structure\n\n## Steps to reproduce\n" }]);
    },
    summaries: { S1: S1_JIRA },
    answers: [{ question: "*", answer: "Bugs are Bug and Defect. Reviews are the review-report only. Also look at cycle time per status, and run our benchmark script." }],
    check: (r) => {
      const problems: string[] = [];
      const retro = (workflow(r).retro ?? {}) as { bugLevels?: string[]; reviewArtifacts?: string[] };
      expect(problems, same([...(retro.bugLevels ?? [])].sort(), ["Bug", "Defect"]), `bugLevels ${JSON.stringify(retro.bugLevels)}`);
      expect(problems, same(retro.reviewArtifacts, ["review-report"]), `reviewArtifacts ${JSON.stringify(retro.reviewArtifacts)}`);
      expect(problems, /bench/.test(fileOf(r, "RETRO.md")) && /cycle time/i.test(fileOf(r, "RETRO.md")), "RETRO.md lacks the benchmark or cycle time");
      noNewErrors(r, problems);
      return problems;
    },
  },
];

/** The checkout every case runs in: a small Next.js shop with Claude Code and Codex files. */
export const CHECKOUT_FILES: Record<string, string> = {
  "README.md": "# Shop\n\nHandmade furniture, ordered online.\n",
  "package.json": `${JSON.stringify(
    {
      name: "shop",
      private: true,
      scripts: { dev: "next dev", test: "vitest run", bench: "bun run bench/index.ts" },
      dependencies: { next: "16.0.0", react: "19.2.0" },
      devDependencies: { vitest: "4.1.0" },
    },
    null,
    2,
  )}\n`,
  "AGENTS.md": "# Agents\n\nRun `bun run test` before you push.\n",
  ".claude/settings.json": "{}\n",
  "bench/index.ts": "console.log('bench');\n",
  "app/page.tsx": "export default function Page() { return null; }\n",
};

export const writeCheckout = (dir: string) => {
  for (const [rel, text] of Object.entries(CHECKOUT_FILES)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
};
