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
```

`--model <model>` picks the model (default `sonnet`). The run needs a logged-in `claude` CLI. It
prints PASS or the failed checks, the tool calls the mock received, and the sandbox folder with
`transcript.jsonl` for inspection. The session runs with `acceptEdits` and an allow-list of the
tools the skill uses, never with permissions bypassed.

The stubs are not CF-14's stage agents: they return fixed JSON so the run exercises only the
orchestrator (preflight, branch, menu, defaults, writer, validation, critic, ship).
