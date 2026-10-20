---
name: crux-retro
description: "Run a CRUX retrospective over one sprint or date range in the project checkout. Use when the user runs crux-retro [<sprint> | --from YYYY-MM-DD --to YYYY-MM-DD] or asks for a sprint retro or a retrospective of the last week. Gathers the period's tickets, bugs and review artifacts from CRUX, follows the project's retro instructions, optionally runs paired A/B benchmarks, turns the recommendations the person picks into tickets and saves the retro."
argument-hint: "[<sprint> | --from YYYY-MM-DD --to YYYY-MM-DD]"
---

# crux-retro [<sprint> | --from … --to …] — run a retrospective

Run it from the project's own checkout: the retro reads the code and its git history.

Needs the crux MCP server connected in this session. If its tools (`retro_context`, `retro_save`,
`perf_submit`, `ticket_create`) are missing, say so, point to the README's "Connect the crux MCP
server" section, and stop.

The procedure — what to analyse, how to rank causes, how to benchmark, how the report and its
recommendations look — is not in this skill. It is the project's `retroMd`, which `retro_context`
returns (CRUX's built-in default when the workflow sets none). This skill only loads the data,
runs the benchmarks the way the period needs and stores the result.

## 1. Load the period

1. **Parse the arguments.**
   - `--from YYYY-MM-DD --to YYYY-MM-DD` (both, inclusive days) → a date range. One without the
     other: ask for the missing one.
   - Any other text → a sprint name, the whole text as given (names may contain spaces).
   - Nothing → the last 7 days.
2. **Find the machine's IANA time zone** for a range or the last 7 days: `$TZ` when it names a
   zone such as `Europe/Kyiv`; else the part after `zoneinfo/` in `readlink /etc/localtime`; else
   the contents of `/etc/timezone`; else `UTC`.
3. **Call `retro_context`** (crux MCP) with exactly one mode: `{ "sprint": "<name>" }`,
   `{ "from": "…", "to": "…", "tz": "<zone>" }` or `{ "tz": "<zone>" }`. On error, show the
   message and handle it:
   - `CONFLICT`, reason `sprint_ambiguous` — several sprints carry the name; list
     `data.candidates` (name, start, end) and ask which one, then call again with its exact name.
   - `CONFLICT`, reason `sprint_has_no_end` — the sprint has no end date; ask the person to set one
     in the tracker or to give a date range.
   - `NOT_FOUND`, reason `sprint_not_found` — no sprint by that name; ask for the exact name, or
     offer a date range.
   - `UNSUPPORTED_BY_TRACKER` — the project's tracker has no sprints; offer the date-range mode
     (`--from/--to`) or the last 7 days.
   - `INVALID_INPUT` — a malformed date or time zone; the message says which. Fix it and call again.
   - The tool reads the tracker under *your* linked identity, so these surface here too:
     - `TRACKER_IDENTITY_REQUIRED` — your link on that tracker is missing or was rejected; its
       `data.linkUrl` is where to (re)link it.
     - `TRACKER_AUTH`, reason `upstream_auth` — the tracker refused your linked account access to
       this project; ask an admin for access.
     - `TRACKER_UNAVAILABLE`, reason `upstream_unavailable` — a tracker outage; retry later.
4. **A `warning`** on page 1 (for example `sprint not completed`): show it and ask whether to
   continue. Stop if the person says no.
5. **Page through the artifacts:** while `nextCursor` is not null, call `retro_context` with
   `{ "cursor": "<nextCursor>" }` alone and collect `artifacts`.

Keep page 1's `period`, `repo`, `previous` and `stats` exactly as returned: `perf_submit` and
`retro_save` take `period` and `stats` back unchanged.

## 2. Analyse

Follow `retroMd` (page 1, `retroMdSource` says whether it is the workflow's or the default). Read
the bugs and artifacts and, where it helps, the code, `git log` over the period and the repo's
rules and check commands.

## 3. Benchmarks — only when `retroMd` describes them

`retroMd` says which suites exist, how to run them, how to name the suite and the testbed, and how
to convert the output to BMF. This skill fixes which commits are compared and how they are run:

1. **Commits.** `git fetch origin`. The ref `<ref>` is `origin/<repo.branch>`; when
   `repo.branch` is null, the remote's HEAD exactly as
   `git symbolic-ref --short refs/remotes/origin/HEAD` prints it (already `origin/<name>`; if it
   is unset, run `git remote set-head origin --auto` first). `--first-parent` keeps to the
   branch's own history, so a commit merged in only after the date is never picked.
   - **B** = `git rev-list -1 --first-parent --before=<period.endsAt> <ref>`.
   - **A** = the `previous[].candidateSha` with the same suite and testbed; otherwise
     `git rev-list -1 --first-parent --before=<period.startsAt> <ref>`. When
     `period.startsAt` is null and no previous run matches, there is no A: say so for that suite
     and skip it.
2. **Worktrees.** Under the main checkout's `.claude/worktrees/`, also when this session runs in
   a subdirectory or in a ticket worktree: `<root>` is the parent directory of
   `git rev-parse --path-format=absolute --git-common-dir`. Add the line `/.claude/worktrees/` to
   `<root>/.git/info/exclude` when it is missing, so the worktrees stay out of `git status`. One
   detached worktree per commit, named by its short sha so suites that share a commit share it:
   `git worktree add --detach <root>/.claude/worktrees/retro-<short sha> <sha>`. A leftover one
   from an earlier run is removed first (step 6).
3. **Install, build, run — A first, then B, never both at once**: they compete for the machine
   and the comparison is only fair when each side has it alone. A benchmark run can outlast a
   tool call (Claude Code's Bash stops at 10 minutes), so run it in the background — Bash
   `run_in_background` in Claude Code, otherwise
   `nohup sh -c '<command>; echo "exit=$?" > <log>.done' > <log> 2>&1 &` — and wait until it
   ends (in that fallback, until `<log>.done` exists; a non-zero exit is a failed side). A command
   that contains a single quote goes into a temporary script file run with `sh`.
4. **Submit.** Convert each side's output to BMF and call `perf_submit` once per suite and testbed:
   `{ period, suite, testbed, baseline: { sha: A, bmf }, candidate: { sha: B, bmf }, directions,
   units? }`, with `period` as page 1 returned it and a direction (`true` when higher is better)
   for every measure. Keep each returned `runId` and show its `rows` as the suite's table.
   `INVALID_INPUT`, reason `direction_missing` names the measures without one; add them and
   submit again.
5. **A side that fails** to install, build or run is not submitted: the report states which side,
   at which commit, with the first error line.
6. **Remove the worktrees** at the end — also when anything above failed:
   `git worktree remove --force <root>/.claude/worktrees/retro-<short sha>` for each one created.

## 4. Report and pick

Show the report and its numbered recommendations in the layout `retroMd` gives. Ask the person to
reply with the numbers to keep (for example `1,3,7`, or `none`) and any edits to titles or
levels. Take the pick as a plain chat reply, not through a question tool: those cap the options
at four, and a retro can have up to 30 recommendations. Apply the edits and show the final list.

## 5. Tickets — only after an explicit "ok"

Once the person has confirmed the final list with an explicit "ok":

1. **Level.** Call `ticket_level_list`. The default level is `Task`; when the project has no
   `Task` level, ask which of its levels to use before creating anything.
2. **Create.** Call `ticket_create` once per picked recommendation: the recommendation's title,
   the level the person asked for (else the default), and a description with its rationale, its
   category and the evidence ticket keys. CRUX places the ticket in the project's create status;
   report the status the returned ticket carries. Keep each created key next to its
   recommendation number.
3. **Errors.** `NOT_FOUND`, reason `level_not_found` — the message lists the project's levels;
   ask which one to use and create that recommendation again. Any other error: show its code and
   reason, create no further tickets, and still save (step 6) with the keys already created, so
   the retro matches the tracker and a re-run does not duplicate them.

## 6. Save

Call `retro_save` with:

- `period` and `stats` exactly as page 1 returned them;
- `report_md` — the report as shown (at most 200 KB);
- `recommendations` — every recommendation shown, as `{ n, title, category, rationale, evidence,
  ticketKey? }`, `ticketKey` set on the ones that became tickets (at most 30);
- `perf_run_ids` — the `runId`s from step 3, if any.

`NOT_FOUND`, reason `perf_run_not_found` lists run ids the project does not have: drop them and
save again. Print the returned `url` and `version` — the retro is on the project's
`/retrospective` page there.
