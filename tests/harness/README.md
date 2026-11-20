# crux-config fixture runs

Manual, headless runs of `/crux:crux-config` that cost model tokens, so `bun test` never starts
them. Each one builds a throwaway sandbox (a bare `origin` and a clone), loads a copy of this plugin
with stub stage agents, serves the crux MCP config tools from the recorded answers in
`tests/fixtures/tools/` (`mock-crux-mcp.ts`), and answers every question from
`CRUX_CONFIG_ANSWERS` instead of a person.

```bash
bun tests/harness/run.ts new-project       # every stage, S4/S5/S8–S11 defaulted, shipped through a PR
bun tests/harness/run.ts edit              # /crux:crux-config edit refiner on an existing .crux/
bun tests/harness/run.ts dashboard-drift   # dashboard edits merged file by file, skills/ kept
bun tests/harness/run.ts missing-mcp       # no crux server: the .mcp.json bootstrap, then a stop
bun tests/harness/run.ts repo-less         # no code repository: a teammate's folder seeded from the export,
                                           # the sourced index skill offered and fetched into .claude/skills/
bun tests/harness/run.ts repo-less-ship    # the same with the skill installed: shipped as files, no PR
```

Claude Code refuses a headless write into `.claude/` (as into `.mcp.json`) unless permissions are
bypassed, which these runs never do: `repo-less` and `missing-mcp` check the write the skill asked
for when the file is not there.

`--model <model>` picks the model (default `sonnet`). The run needs a logged-in `claude` CLI, or
`--token-file <path>`: a file holding a `claude setup-token` token, handed only to the child
`claude` as `CLAUDE_CODE_OAUTH_TOKEN` and never printed. It
prints PASS or the failed checks, the tool calls the mock received, and the sandbox folder with
`transcript.jsonl` for inspection. The session runs with `acceptEdits` and an allow-list of the
tools the skill uses, never with permissions bypassed.

`stage-repo-less.ts` drives the same repo-less tool calls against a real server, with no model:
`config_context` (must be `repos.code: null`), `workflow_export` (or the `name-only-index` fixture
when there is no workflow), `skill_fetch` per index skill with a `source`, `workflow_validate
{files}` and the import preview; `--import` also imports (it activates the package on that
project) and reads `workflow_readiness`.

```bash
bun tests/harness/stage-repo-less.ts --url https://stage.crux.team/mcp/p/<projectId> --token-file <path> [--import]
```

Against a local stack, add `--resolve object-store:9000=127.0.0.1:<its object-store port>`: its
signed URLs name the store's in-network host, which the script then reaches at that address.

The stubs are not CF-14's stage agents: they return fixed JSON so the run exercises only the
orchestrator (preflight, branch, menu, defaults, writer, validation, critic, ship).

## Stage agents

`stages.ts` runs the real stage agents (`agents/config-*.md`) one at a time, without the
orchestrator: `claude -p --agent crux:config-<stage>` with the launch message of
`skills/crux-config/references/stage-contract.md`.

- Each case in `stage-cases.ts` sets the tracker context (`tests/fixtures/tools/{new-project,plane,linear,github}/config_context.json`), the starting `.crux/`, the earlier stages' summaries and the person's answers. The answers are facts; a `*` entry answers any question.
- The harness resumes the agent with `{answers}` until it closes. A stage that closes in its first answer fails.
- It applies the agent's `changes` (`stage-lib.ts`), runs `validate.mjs` and checks the result.
- The critic leg runs `crux:config-critic` on the clean generic package (findings reported, not failed) and on each seeded violation of `critic-cases.ts`. It expects a finding with that case's `check` and `stage`.
- S8's `skills find` is a stub that prints `tests/fixtures/tools/skills-find.txt`. Its `WebFetch` reads skill pages on `skills.sh` live: the one tool output the runs do not replay from a recording.
- Tracker coverage: statuses, levels and estimates, which read the tracker, run on all four shapes. The other stages read no tracker field beyond the project and run on one or two (product and rules with and without a wiki, pipeline with and without provider keys, skills with and without a wiki).

```bash
bun tests/harness/stages.ts all                            # every stage case and the critic leg, on sonnet
bun tests/harness/stages.ts statuses --tracker github      # one stage on one tracker shape
bun tests/harness/stages.ts critic --case builder-verifies-itself
bun tests/harness/stages.ts pipeline --ollama qwen3.6:35b-mlx   # iterate on a prompt for free
```

Run on Claude first. Debug a case that fails on a local Ollama model (`--ollama <model>`, at
`http://localhost:11434`), then confirm the fix on Claude. `--jobs <n>` runs cases in parallel
(default 4). `--token-file` works as above. Every case leaves its folder in the printed sandbox,
with `replies.json` holding the agent's answers.
