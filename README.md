# CRUX skills

Agent skills for teams that run their tickets through a [CRUX](https://github.com/cruxteam) pipeline.
One repository installs as the `crux` plugin in **Claude Code**, **Codex**, **GitHub Copilot**
(CLI and VS Code) and **Gemini CLI**, and the skills behave the same way in each of them.

| Skill | What it does |
|---|---|
| [`crux-dispatch <role>`](skills/crux-dispatch/SKILL.md) | Shows a role's pipeline board, lets you pick tickets, claims each pick and opens one new agent session per pick |
| [`crux-run <KEY>-N <agent>`](skills/crux-run/SKILL.md) | Claims one pipeline step and opens a new agent session for it |
| [`crux-worktree <KEY>-N`](skills/crux-worktree/SKILL.md) | Moves the work into the ticket's own git worktree (`.claude/worktrees/<KEY>-N`, branch `<KEY>-N`) |
| [`crux-retro [<sprint> \| --from … --to …]`](skills/crux-retro/SKILL.md) | Runs a retrospective over a sprint, a date range or the last 7 days: analyses its bugs and review findings, optionally benchmarks the period's start against its end, turns the recommendations you pick into tickets and saves the retro to CRUX |

Every new session starts from a short bootstrap prompt that fetches the agent's real
instructions from the crux MCP server, so nothing long is ever copied between sessions.

## Install

Pick **one** route per agent: a plugin and a skills.sh copy together give you every skill twice.

<details open>
<summary><strong>Claude Code</strong></summary>

```bash
claude plugin marketplace add cruxteam/skills
claude plugin install crux@cruxteam
```

To get updates automatically, turn on auto-update for the `cruxteam` marketplace in
`/plugin` → **Marketplaces** (it is off by default for third-party marketplaces). Otherwise run
`claude plugin marketplace update cruxteam`.

</details>

<details>
<summary><strong>Codex</strong></summary>

```bash
codex plugin marketplace add cruxteam/skills
codex plugin add crux@cruxteam
```

Updates itself at startup.

</details>

<details>
<summary><strong>GitHub Copilot CLI</strong></summary>

```bash
copilot plugin marketplace add cruxteam/skills
copilot plugin install crux@cruxteam
```

To get updates automatically, add this once to `~/.copilot/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "cruxteam": { "source": { "source": "github", "repo": "cruxteam/skills" }, "autoUpdate": true }
  }
}
```

</details>

<details>
<summary><strong>VS Code (GitHub Copilot Chat)</strong></summary>

Run **Chat: Install Plugin From Source** from the Command Palette and enter
`https://github.com/cruxteam/skills`. It updates daily while `extensions.autoUpdate` is on.

</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

```bash
gemini extensions install https://github.com/cruxteam/skills --auto-update
```

Updates at startup when a new release is published.

</details>

<details>
<summary><strong>Any other agent, or editable copies</strong> (manual updates)</summary>

```bash
npx skills@latest add cruxteam/skills
```

Take all four skills (`crux-dispatch` and `crux-run` use the script that ships with
`crux-worktree`; `crux-retro` needs no other skill). Update with `npx skills@latest update`.

</details>

## Connect the crux MCP server

The skills call the crux MCP server, which belongs to your project rather than to this plugin.
Its address is `https://<your CRUX host>/mcp/p/<projectId>` and it takes your personal token as
`Authorization: Bearer <token>`. Get the token from **Connect your local agents** in the CRUX
dashboard and put it in the `CRUX_MCP_TOKEN` environment variable. None of the files below holds
a secret, so they are safe to commit.

<details open>
<summary><strong>Claude Code</strong>: <code>.mcp.json</code> in the project repo</summary>

```json
{
  "mcpServers": {
    "crux": {
      "type": "http",
      "url": "https://<your CRUX host>/mcp/p/<projectId>",
      "headers": { "Authorization": "Bearer ${CRUX_MCP_TOKEN}" }
    }
  }
}
```

Keep the token in the gitignored `.claude/settings.local.json`:
`{ "env": { "CRUX_MCP_TOKEN": "crux_pat_…" }, "enabledMcpjsonServers": ["crux"] }`, then restart
Claude Code and approve the project server.

</details>

<details>
<summary><strong>Codex</strong>: <code>~/.codex/config.toml</code></summary>

```bash
codex mcp add crux --url https://<your CRUX host>/mcp/p/<projectId> --bearer-token-env-var CRUX_MCP_TOKEN
```

This writes `[mcp_servers.crux]` with `bearer_token_env_var = "CRUX_MCP_TOKEN"`. A trusted project
can keep the same table in `.codex/config.toml`.

</details>

<details>
<summary><strong>GitHub Copilot CLI</strong>: <code>.mcp.json</code> in the project repo, or <code>~/.copilot/mcp-config.json</code></summary>

Copilot CLI reads the same project `.mcp.json` as Claude Code. In `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "crux": {
      "type": "http",
      "url": "https://<your CRUX host>/mcp/p/<projectId>",
      "headers": { "Authorization": "Bearer ${CRUX_MCP_TOKEN}" },
      "tools": ["*"]
    }
  }
}
```

</details>

<details>
<summary><strong>VS Code</strong>: <code>.vscode/mcp.json</code></summary>

```json
{
  "inputs": [{ "type": "promptString", "id": "crux-token", "description": "CRUX personal token", "password": true }],
  "servers": {
    "crux": {
      "type": "http",
      "url": "https://<your CRUX host>/mcp/p/<projectId>",
      "headers": { "Authorization": "Bearer ${input:crux-token}" }
    }
  }
}
```

VS Code asks for the token once and stores it securely.

</details>

<details>
<summary><strong>Gemini CLI</strong>: <code>.gemini/settings.json</code> in the project repo</summary>

```json
{
  "mcpServers": {
    "crux": {
      "httpUrl": "https://<your CRUX host>/mcp/p/<projectId>",
      "headers": { "Authorization": "Bearer $CRUX_MCP_TOKEN" }
    }
  }
}
```

</details>

## Use

| Runner | Call a skill |
|---|---|
| Claude Code | `/crux:crux-run CR-12 developer` |
| Codex | `$crux:crux-run CR-12 developer` |
| GitHub Copilot (CLI and VS Code) | `/crux-run CR-12 developer` |
| Gemini CLI | `/crux-run CR-12 developer` |

You can also just ask in plain words, for example "start CR-12 with the developer agent".

### How a new session starts

`crux-run` and `crux-dispatch` claim the step first, then open a session for it:

- **Claude Desktop** lets the agent create a session card. Click it to start the session.
- **Every other runner** has no tool for opening a session. Instead the skill creates the
  ticket's worktree and prints one command per session. Run each in its own terminal tab:

  | Runner | The printed command |
  |---|---|
  | Claude Code | `cd "<worktree>" && claude '<bootstrap>'` (or `claude --bg …`, then `claude attach <id>`) |
  | Codex | `cd "<worktree>" && codex '<bootstrap>'` |
  | GitHub Copilot CLI | `cd "<worktree>" && copilot -i '<bootstrap>'` |
  | Gemini CLI | `cd "<worktree>" && gemini -i '<bootstrap>'` |
  | VS Code | `code "<worktree>"`, then paste the bootstrap into a new agent chat |

Either way the step is already claimed, so nobody else is offered it. A session you never start
keeps the claim until you unassign it in the dashboard.

Worktrees come from [`ticket-worktree.sh`](skills/crux-worktree/scripts/ticket-worktree.sh), plain
git with no dependencies. If your repository needs more (linked env files, a dependency install),
name your own ticket-worktree command in `AGENTS.md` or `CLAUDE.md`. The skills run that command
instead, and it must print the worktree path the same way.

## Contributing

See [AGENTS.md](AGENTS.md). Run `bun test` before opening a PR.

### Republishing `validate.mjs`

[`skills/crux-config/scripts/validate.mjs`](skills/crux-config/scripts/validate.mjs) checks a
project's `.crux/` folder offline with the same rules as the CRUX server. It is generated in the
CRUX monorepo from `@crux/workflow-types`, and its banner names the rules version it was built
from (`// RULES_VERSION <n>`). Never edit it here. Republish it every time the monorepo bumps
`RULES_VERSION`:

1. In a CRUX monorepo checkout on `dev`, build it straight into this repo:
   `bun run plugin:build-validator --out <this repo>/skills/crux-config/scripts/validate.mjs`.
2. If the rules change made the sample folders in [`tests/fixtures/`](tests/fixtures) stale, copy
   them again from the monorepo's `packages/workflow-types/test/fixtures/`.
3. Run `bun test`. It runs the new bundle on the sample folders under both `bun` and `node`.
4. Open a PR, then release it (AGENTS.md, *Release*) so Codex and Copilot reinstall.

Nothing checks that the copy here is current. Once the `crux-config` skill lands, it compares the
banner's rules version with the server's and warns on a mismatch.

## License

[MIT](LICENSE)
