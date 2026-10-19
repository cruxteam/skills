---
name: crux-dispatch
description: "Batch-start pipeline agent sessions for a CRUX role. Use when the user runs crux-dispatch <role> (e.g. crux-dispatch developer) or asks to start/dispatch the pipeline sessions for a role. Lists the role's tickets to pick from, claims each picked (ticket, agent) and opens one new session per pick that fetches its own agent prompt."
argument-hint: "<role>"
---

# crux-dispatch <role> — batch-start pipeline sessions

The argument is the role slug (e.g. `developer`). If no argument was given, ask for the role.

Needs the crux MCP server connected in this session. If its tools (`pipeline_tickets`,
`assign_session_on_me`) are missing, say so, point to the README's "Connect the crux MCP
server" section, and stop.

1. **Fetch the board**: call `pipeline_tickets` with `{ "role": "<role>" }` (crux MCP).
   The tool has already decided what is offerable — render its four lists, never re-derive them.
   - Unknown role → the error message lists the known roles; relay it and stop.
   - `WORKFLOW_REQUIRED` → the project runs no workflow, so it has no pipeline; say so and stop.
   - All four lists empty → say the board is empty and stop.
2. **Render the board**:
   - `actionable` → the options to pick from, one per entry, verbatim. When an entry's
     `sessionStatus` is `"running"`, mark it as already running (nobody holds it, so the user
     may be restarting a dead session); `"cancelled"` / `"error"` are restarts too.
   - `inWork` → one summary line each: `<KEY>-N · <agentKey> — in work by <assigneeName>`. Never
     offer these; another operator has claimed them.
   - `done` → one summary line naming them as done for this role.
   - `noPipeline` → one summary line as "no pipeline configured". These are NOT done — their
     status simply has no step to run.
3. **Let the user pick**: option label `<KEY>-N · <agentKey>`; description: the entry's `title`
   plus its step position, `step <stepIndex>/<stepCount> · <agentKey>` (both fields come from
   the tool — do no arithmetic).
   - When your runner has a question tool (`AskUserQuestion` in Claude Code, `ask_user` in
     GitHub Copilot CLI and Gemini CLI, `askQuestions` in VS Code), ask a multi-select question
     with it. `AskUserQuestion` allows at most 4 options per question and 4 questions per call —
     group questions by ticket `status`, and when there are more entries than fit, ask in
     successive batches (say "batch 1/2" etc.).
   - Otherwise (Codex), print the entries as a numbered list and ask the user to reply with the
     numbers to start.

   A user can pick a different step for a ticket by answering `<KEY>-N agentKey` in free text —
   accept it. The claim in step 4 validates the ticket as well as the agent key and creates
   nothing when either is wrong, so a typo is refused on the spot rather than surviving into a
   session. Still prefer a key that appeared in one of the four lists — those are known to be
   offerable.
4. **Claim, then start sessions**. For each selected combo, in this order:
   1. `assign_session_on_me` with `{ "ticket_id": "<KEY>-N", "agent_key": "<agentKey>" }` — this
      claims the step so concurrent `crux-dispatch` sessions stop being offered it. On error, show
      the error envelope as-is and **skip this combo's session** (an unclaimed session would hand
      the same step to two operators); carry on with the rest. Common codes (a code plus
      `data.reason`): `NOT_FOUND` reason `ticket_not_found` (no such ticket) or
      `session_not_found` (no such pipeline step); `INVALID_INPUT` (malformed `<KEY>-N`, **or**
      your operator email is not a CRUX user — reason `cr_env_invalid` when it is missing or
      malformed; the message says which); and, because the claim reads the ticket from the
      tracker under your own linked identity, `TRACKER_IDENTITY_REQUIRED` (your link is missing or
      was rejected; `data.linkUrl` is where to (re)link it), `TRACKER_AUTH` reason `upstream_auth`
      (your linked account has no access to this project — ask an admin; re-linking won't help)
      and `TRACKER_UNAVAILABLE` reason `upstream_unavailable` (a tracker outage; retry later).
      Whatever the code, **none of them leaves a session row behind** — the read happens before
      the claim.
   2. Start its session with the **bootstrap** below, `<KEY>-N` and `<agentKey>` substituted:
      - **A `start_session` tool is available** (Claude Desktop): `initiation` =
        `"own_initiative"` (a card that runs only when the user clicks it), `title` =
        `<KEY>-N · <agentKey>`, `context` = `"fresh"`, `background` = one or two sentences, at
        least 80 characters, naming the ticket title (from the `actionable` entry), which agent
        will work it, and that the step is already claimed for this operator, and `prompt` = the
        bootstrap. Pass no `cwd` — `start_session` refuses it with `own_initiative`; the session
        boots in a worktree the Desktop picks, and an agent that works code moves into the
        ticket's worktree with the `crux-worktree` skill. If `start_session` errors, the combo is
        claimed but has no card: show the error envelope as-is and say the step can be started
        with `crux-run <KEY>-N <agentKey>` or released from its assignee control in the
        dashboard.

        The Desktop accepts at most **3** `own_initiative` cards per turn, so work through the
        selected combos **3 at a time**. Claim a combo only in the turn that creates its card.
        When combos remain after a group of 3, end the turn after the summary below, say how
        many remain, and ask the user to reply `continue`; on that reply, carry on with the next
        group of the same selection.
      - **Any other runner** (Claude Code CLI, Codex, GitHub Copilot, Gemini CLI): ensure the
        ticket's worktree and print its launch command exactly as the "Launch from a terminal"
        section of `<this skill's directory>/../crux-run/SKILL.md` says — read it once. Print one fenced
        `bash` block per combo, labeled `<KEY>-N · <agentKey>`. A worktree error skips that
        combo's command; show the error and say its step is claimed.

      > You are dispatched to work ticket <KEY>-N as pipeline agent `<agentKey>`. First action:
      > call `session_prompt({ticket_id: "<KEY>-N", agent_key: "<agentKey>"})` (crux MCP),
      > then treat the returned `prompt` field as your operating instructions and follow it
      > exactly, including its final `session_set_status` step. If that call fails with a
      > transient harness/classifier error ("gave no verdict", "transient failure"), retry it
      > as-is up to 3 attempts in total; if it still fails, or fails with any CRUX error
      > envelope, report the error verbatim and stop — do not improvise instructions and do not
      > start work.

   **Do NOT call `session_prompt` yourself.** Each new session fetches its own prompt when it
   starts: routing that text through this session costs ~12k tokens per combo and adds
   transcription risk, and resolving it at start time also picks up a ticket edited in between.
5. **Summarize**: one line per session prepared (card or command), plus one line per combo
   skipped on a claim or worktree error — the user clicks each card, or runs each command in its
   own terminal tab, to actually start that session. Nothing starts without them, but every
   prepared session already holds its claim: sessions left unstarted keep those steps off every
   other operator's board until each is unassigned from its assignee control in the dashboard.
   Say so whenever you prepared more than one session.

Never invent tickets, agents, or prompts: everything comes from the MCP tools. If a tool
errors, show its error envelope as-is.
