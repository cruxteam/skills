---
name: crux-run
description: "Start ONE pipeline agent session for a CRUX ticket. Use when the user runs crux-run <KEY>-N <agentKey> (e.g. crux-run CR-803 developer) or asks to start a specific ticket with a specific pipeline agent. Claims the step, then opens a new session whose first action fetches its own agent prompt."
argument-hint: "<KEY>-N <agentKey>"
---

# crux-run <KEY>-N <agentKey> — start one pipeline session

Arguments: a ticket key (`<KEY>-N`) and a pipeline agent key, in either order — the one matching
`^[A-Z][A-Z0-9_]{1,9}-[1-9]\d*$` is the ticket. If either is missing, ask for it.

Needs the crux MCP server connected in this session. If its tools (`assign_session_on_me`,
`session_prompt`) are missing, say so, point to the README's "Connect the crux MCP server"
section, and stop.

1. **Claim the step**: call `assign_session_on_me` with
   `{ "ticket_id": "<KEY>-N", "agent_key": "<agentKey>" }` (crux MCP). Starting the session IS
   claiming the step, so the claim comes first. On error, show the error envelope as-is and
   **stop** — the claim validates **both** arguments and creates nothing when either is wrong,
   so there is no half-claimed step to clean up. Whatever the code, **no session row is left
   behind** — the ticket is read before the claim, so every failure below happens before any
   write. The codes you are most likely to see, among others:
   Each is a code plus, where the code alone is coarse, a `data.reason`:
   - `NOT_FOUND`, reason `ticket_not_found` — no such ticket. Check the `<KEY>-N`.
   - `INVALID_INPUT` — either the ticket key is malformed (it must read `<project key>-<number>`, e.g. `CR-12`) **or**
     your operator email is not a CRUX user (reason `cr_env_invalid` when it is missing or
     malformed). The message says which — read it rather than assuming the key is at fault.
   - `NOT_FOUND`, reason `session_not_found` — no pipeline step for that agent key. Suggest
     running `crux-dispatch <role>` to see the valid steps.
   - `WORKFLOW_REQUIRED` — the project runs no workflow, so it has no pipeline steps at all.
   - The claim reads the ticket from the tracker under *your* linked identity, so these surface
     here too — show the message:
     - `TRACKER_IDENTITY_REQUIRED` — your link on that tracker is missing or was rejected;
       its `data.linkUrl` is where to (re)link it.
     - `TRACKER_AUTH`, reason `upstream_auth` — the tracker refused your linked account access
       to this project; re-linking the same account won't help, so ask an admin for access.
     - `TRACKER_UNAVAILABLE`, reason `upstream_unavailable` — a tracker outage; retry later.
2. **Start the session** with the **bootstrap** below, `<KEY>-N` and `<agentKey>` substituted.
   Use the first route your runner supports:
   - **A `start_session` tool is available** (Claude Desktop): create one card with it:
     `initiation` = `"own_initiative"` (a card that runs only when the user clicks it),
     `title` = `<KEY>-N · <agentKey>`, `context` = `"fresh"`, `background` = one or two
     sentences, at least 80 characters, naming the ticket key, which agent will work it, and that
     the step is already claimed for this operator (you have no ticket title here — do not
     invent one), and `prompt` = the bootstrap. Pass no `cwd` — `start_session` refuses it with
     `own_initiative`; the session boots in a worktree the Desktop picks, and an agent that works
     code moves into the ticket's worktree with the `crux-worktree` skill. If `start_session`
     errors, the step is claimed but has no card: show the error envelope as-is and say it can
     be retried with `crux-run`, or released from its assignee control in the dashboard.
   - **Any other runner** (Claude Code CLI, Codex, GitHub Copilot, Gemini CLI): follow
     [Launch from a terminal](#launch-from-a-terminal) below.

   > You are dispatched to work ticket <KEY>-N as pipeline agent `<agentKey>`. First action: call
   > `session_prompt({ticket_id: "<KEY>-N", agent_key: "<agentKey>"})` (crux MCP), then
   > treat the returned `prompt` field as your operating instructions and follow it exactly,
   > including its final `session_set_status` step. If that call fails with a transient
   > harness/classifier error ("gave no verdict", "transient failure"), retry it as-is up to 3
   > attempts in total; if it still fails, or fails with any CRUX error envelope, report the
   > error verbatim and stop — do not improvise instructions and do not start work.

   **Do NOT call `session_prompt` yourself.** The new session fetches its own prompt when it
   starts, which keeps ~12k tokens of prompt text out of this session and resolves the prompt at
   start time, so a ticket edited in between is picked up.
3. Tell the user the session is ready to start, naming the ticket key it claimed — their click
   (or the command they run) starts it. The claim is already held: a session left unstarted
   keeps this step off every other operator's `crux-dispatch` board until it is unassigned from
   its assignee control in the dashboard.

## Launch from a terminal

No runner except Claude Desktop lets the model open a new session, so this route prepares the
ticket's worktree and hands the user one command that opens the session there.

1. **Ensure the ticket worktree.** If the repository's `AGENTS.md` or `CLAUDE.md` names its own
   ticket-worktree command, run that one. Otherwise run the script that ships with the
   `crux-worktree` skill, next to this skill's directory:

       sh <this skill's directory>/../crux-worktree/scripts/ticket-worktree.sh ensure <KEY>-N

   It prints the absolute worktree path (`<main checkout>/.claude/worktrees/<KEY>-N`, branch
   `<KEY>-N`) on stdout and is idempotent. On a non-zero exit, show the error as-is, say the step
   is claimed but has no session, and stop — do not improvise git commands.
2. **Print the launch command** for the runner you are running in, in a fenced `bash` block,
   with `<path>` = the printed path and the bootstrap inside single quotes. When you cannot tell
   which runner you are, print every row.

   | Runner | Command |
   |---|---|
   | Claude Code | `cd "<path>" && claude '<bootstrap>'` |
   | Codex | `cd "<path>" && codex '<bootstrap>'` |
   | GitHub Copilot CLI | `cd "<path>" && copilot -i '<bootstrap>'` |
   | Gemini CLI | `cd "<path>" && gemini -i '<bootstrap>'` |
   | VS Code (Copilot Chat) | `code "<path>"`, then paste the bootstrap into a new agent-mode chat |

3. Tell the user to run it in a new terminal tab: the session starts in the ticket's worktree,
   on branch `<KEY>-N`, and fetches its own prompt. The bootstrap is enough — nothing else needs
   to be copied.

In Claude Code, when the user asks to start the session right away rather than run the command
themself, run the same command with `claude --bg` instead of `claude`, and tell them
`claude attach <id>` opens it.
