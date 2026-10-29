# What a hosted ADVISOR can do with a skill

An ADVISOR runs on the CRUX server. It has:

- read access to the code and the wiki, each only when `accessCode` / `accessWiki` is `READ`;
- the crux MCP tools its `permission` allows, and the HTTP MCP servers attached to it;
- web fetch and search, when its permission allows them;
- **no shell, no file writes, no git.**

`load_skill` serves the skill's `SKILL.md`, plus its `.md` and `.txt` files under `references/`
or `assets/` (at any depth, 256 KiB each, 1 MiB together). Nothing else of the skill reaches the
agent.

A skill does **not** fit an ADVISOR when it:

1. ships executable files it tells the agent to run;
2. names shell or file-write tools in `allowed-tools` (`Bash`, `Write`, `Edit`, `MultiEdit`,
   `NotebookEdit`);
3. tells the agent to run commands (a `bash`/`sh`/`shell` code block), edit or create files, or
   use git (`git commit`, `git push`, …);
4. points at sibling files that are not served (`scripts/…`, or anything outside `references/`
   and `assets/`).

A **third-party skill on an agent with code read and web fetch** fits but is flagged: the skill's
text could steer the agent to send code out. Show the person the warning with the source.

On a mismatch S8 offers, in this order: another skill that fits; making the agent a WORKER (it
then runs on a person's machine with their local tools, and its skills live in the repository's
native skill folders); or skipping the skill. When nothing fits, S8 drafts a project skill under
`.crux/skills/<name>/` that does.

The validator (`validate.mjs`), `workflow_validate` and the dashboard report the same issues from
one function of the CRUX rules set, as warnings on the agent's `agent.yaml`.

## Obsidian skills

When the project has a wiki (bound, or decided in S1), S8 proposes `kepano/obsidian-skills`:
`obsidian-markdown` by default for every agent with `accessWiki: READ` and for the agent that
writes the wiki; `obsidian-bases` and `json-canvas` on request; `obsidian-cli`, `defuddle` and
`knap` for WORKER agents only, since they run a CLI.
