---
name: crux-worktree
description: "Enter the ticket's own git worktree before working a CRUX ticket's code. Use when a pipeline agent (developer, reviewer) starts on a ticket, or when the user runs crux-worktree <KEY>-N. Creates or reuses .claude/worktrees/<KEY>-N on branch <KEY>-N, moves the work there, and removes the random launch worktree Claude Desktop created."
argument-hint: "<KEY>-N"
---

# crux-worktree <KEY>-N — work in the ticket's worktree

Argument: the ticket key (`<KEY>-N`, e.g. `CR-12`). If it is missing, ask for it.

Every pipeline agent of a ticket works in the worktree named after it, so that `developer` and
`reviewer` share one directory and one branch, and the reviewer never has to look the branch up.

1. **Remember where you started**: run `pwd` and keep the result as `ORIGIN`.
2. **Ensure the ticket worktree.** If the repository's `AGENTS.md` or `CLAUDE.md` names its own
   ticket-worktree command, run that one: it may also link local files or install
   dependencies. Otherwise run the script next to this file:

       sh <this skill's directory>/scripts/ticket-worktree.sh ensure <KEY>-N

   Either prints one line on stdout — the absolute worktree path — and progress on stderr. The
   bundled script is idempotent: an existing `.claude/worktrees/<KEY>-N` is reused, a local
   `<KEY>-N` branch is reused, a remote-only `origin/<KEY>-N` is tracked, otherwise `<KEY>-N` is
   created from the remote's default branch. On a non-zero exit, show the error as-is and
   **stop** — do not improvise git commands. A project command that installs dependencies can
   take minutes, so give it a long tool timeout when your runner has one.
3. **Move the work there.** If `ORIGIN` already is the printed path, skip this step.
   - **Claude Code** (CLI or Desktop): call `EnterWorktree({ path: "<the printed path>" })`.
   - **Other runners** (Codex, GitHub Copilot, Gemini CLI) cannot move a running session. Keep
     working in this session, but run every shell command from the worktree (`cd "<path>" && …`,
     or the shell tool's working-directory parameter) and read and edit files by their paths under
     it. If the user would rather have a session that starts there, give them the matching
     launch command from the "Launch from a terminal" table in
     `<this skill's directory>/../crux-run/SKILL.md`.
4. **Remove the launch worktree** (Claude Desktop): only if `ORIGIN` is under `.claude/worktrees/`
   and is not the printed path, run

       sh <this skill's directory>/scripts/ticket-worktree.sh cleanup "<ORIGIN>"

   It removes the worktree and its `claude/*` branch, and refuses (exit 1, nothing touched)
   when the branch is not `claude/*`, the tree is dirty, or HEAD carries commits that no remote
   branch has. Report a refusal in one line and carry on — it never blocks the ticket.
5. **Confirm**: run `git branch --show-current` in the worktree — it must read `<KEY>-N`. From
   here on every read, edit, test and commit happens in this worktree.

## Working in the worktree

- **Enter once.** When another skill later asks for an isolated workspace, this worktree is it:
  do not create or enter another one.
- **Never edit or commit in the main checkout** while working the ticket.

## After a Claude Desktop session is resumed

Step 4 deletes the launch worktree the Desktop recorded for this session, so on a resume the
Desktop reports that the session's old worktree was removed and reopens the session in the main
checkout. Nothing was lost — `cleanup` never removes a dirty tree or unpushed commits — but you
are no longer in the ticket's worktree. Before any further read, edit, test or commit:

1. Call `EnterWorktree({ path: "<main checkout>/.claude/worktrees/<KEY>-N" })` — the same
   `<KEY>-N` this skill ran for. If that directory is missing, run step 2 above again instead.
2. Run `git branch --show-current` — it must read `<KEY>-N`.

Do not run `cleanup` again.
