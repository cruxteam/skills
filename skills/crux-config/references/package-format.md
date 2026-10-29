# The `.crux/` package (version 5)

crux-config rewrites whole files in exactly this shape, so a package it writes and the one the
server exports compare equal. `validate.mjs` checks every rule below; the layout is closed — a
file or folder not listed here is an error.

## Layout

```
.crux/
  workflow.yaml                    the model: roles, flows, levels, switches, indexes
  ADVISORS.md                      shared rules for every agent (S10)
  RETRO.md                         optional: the retro procedure (S11); absent = the built-in one
  levels/<Level>.md                one per level (S4)
  agents/<agent>/agent.yaml        the agent's metadata (S6, S7)
  agents/<agent>/system-prompt.md
  agents/<agent>/first-message.md  PIPELINE agents only
  agents/<agent>/desktop-overrides.md   optional
  agents/<agent>/skills/<skill>    symlink → ../../../skills/<skill>        (an attachment)
  agents/<agent>/mcp/<server>.json symlink → ../../../mcp/<server>.json     (an attachment)
  skills/<skill>/SKILL.md …        installed skills (S8)
  skills-lock.json                 {"version": 1, "skills": {"<skill>": <skill_fetch lockEntry>}}
  mcp/<server>.json                MCP servers (S9)
```

Files end with exactly one newline, LF only. YAML: map keys sorted, 2-space indent, no line
folding, no anchors. Names that become a path segment (agents, levels, skills, servers, artifacts)
contain no `/` or `\` and are not `.` or `..`; show the person the slug you made of a non-Latin
name.

## `workflow.yaml`

```yaml
entryFlow: To Do                 # the status new tickets enter; a roleFlows key (S3)
estimateScale:                   # only when estimates is on and the tracker has no native scale
  - 1
  - 2
  - 3
  - 5
  - 8
estimates: on                    # on | off (S5); on needs the tracker's scale or estimateScale
mcpServers:                      # index of every server an agent attaches (S9)
  - name: sentry
name: Shop workflow
retro:                           # S11; absent = bugLevels [Bug], reviewArtifacts [review-report]
  bugLevels:
    - Bug
  reviewArtifacts:
    - review-report
roleFlows:                       # one key per tracker status, its exact name (S3)
  In Progress:
    chatAgents: []               # CHAT agents of this status (S7)
    expectedGroup: started       # the tracker's group for the status
    pipeline:                    # PIPELINE agents, in order (S6)
      - planner
      - builder
    role: developer              # the one owning role
roles:                           # S2
  developer:
    color: "#e3b25c"
    description: Builds the change and reviews other developers' changes.
    icon: users
    slug: developer
    title: Developer
skills:                          # index of every installed or name-only skill (S8)
  - name: grill-me
    source: mattpocock/skills@grill-me
version: "5"
```

- `roles.<slug>.slug` equals its key (kebab-case). Every `roleFlows.*.role` names a role.
- Every lane entry names an agent of the matching kind; an agent sits in exactly one status.
- There is no `levels` key: the levels are the files in `levels/`.
- Absent `estimates`, `retro`, `entryFlow`, `skills` and `mcpServers` keys are written as absent,
  not empty.

## `agents/<agent>/agent.yaml`

ADVISOR (hosted):

```yaml
accessCode: NONE        # NONE | READ
accessWiki: NONE        # NONE | READ — READ needs a wiki repository
artifact: acceptance-criteria   # required for PIPELINE, optional for CHAT, unique
chatRetention: D7
fallbackModel: null
fallbackProvider: null
kind: PIPELINE          # PIPELINE | CHAT
maxSteps: 40
model: claude-sonnet-4-6
permission:             # least privilege, see agent-prompt-template.md
  bash: deny
  mcp_crux_*: deny
  mcp_crux_comment_create: allow
  mcp_crux_session_set_status: allow
  mcp_crux_ticket_get: allow
  webfetch: deny
  websearch: deny
provider: anthropic     # a provider in config_context.llmProviders
runtime: ADVISOR
```

An ADVISOR's attachments are the symlinks in its folder (`skills/`, `mcp/`); in a project without
a repository they are the names in the `skills` / `mcpServers` lists of its `agent.yaml`.

WORKER (runs on a person's machine; always PIPELINE):

```yaml
artifact: change-summary
runtime: WORKER
skills:                    # names in the repository's native skill folders
  - change-summary
```

## `levels/<Level>.md`

```markdown
---
color: "#4c9aff"
---

## Description

<one paragraph>

## Structure

<the ticket body template>
```

The `color` frontmatter is optional. The file name is the level name.

## `ADVISORS.md`

`# Shared rules`, then the default principles (`principles.md`) as a numbered list, the
quoted-data line, then the team's rules, language and artifact format (S10).

## A new package

The first stage written creates `.crux/workflow.yaml` with only `name: <project.name> workflow`,
`roleFlows: {}`, `roles: {}` and `version: "5"`; every stage adds its part.

## Stage → paths and defaults

| Stage | Paths and fields | Default (`changes` of "Use defaults and continue") |
|---|---|---|
| S1 product | the context section of `ADVISORS.md`; `accessCode`/`accessWiki` defaults | — |
| S2 roles | `workflow.yaml` `roles` | — |
| S3 statuses | `roleFlows` keys, `role`, `expectedGroup`; `entryFlow` | — |
| S4 levels | `levels/*.md` | one level per `tracker.issueTypes` name, stock description and structure |
| S5 estimates | `estimates`, `estimateScale` | `estimates: "off"`, no `estimateScale` |
| S6 pipeline | `agents/<PIPELINE agent>/`, `roleFlows.*.pipeline` | — |
| S7 chat | `agents/<CHAT agent>/`, `roleFlows.*.chatAgents` | none: no changes |
| S8 skills | `skills/`, `skills-lock.json`, `skills` index, skill attachments | none: no changes |
| S9 MCP | `mcp/`, `mcpServers` index, server attachments | none: no changes |
| S10 rules | `ADVISORS.md` | `# Shared rules` + the principles + the quoted-data line |
| S11 retro | `RETRO.md`, `retro` | no `RETRO.md`, no `retro` (the built-in defaults) |

A validation issue's `path` maps back to its stage through this table (`agents/<a>/…` to S6 or S7
by the agent's kind; `workflow.yaml` by the field the message names).

## Changes

A stage agent returns `changes`, a list applied in order:

| `op` | Fields | Effect |
|---|---|---|
| `add` | `kind` (`role`, `flow`, `agent`, `level`, `attachment`), `name`, `value` | create the item and its files |
| `rename` | `kind`, `from`, `to` | rename and cascade (below) |
| `remove` | `kind`, `name` | delete the item, its files and every reference |
| `set` | `path` (a file, or `workflow.yaml` + a dotted field), `value` | replace that value or file body |

Renames cascade through the whole package:

- **role slug** — `roles` key and `slug`, every `roleFlows.*.role`;
- **status name** — the `roleFlows` key, `entryFlow`;
- **agent name** — every lane entry, the folder `agents/<name>/`, prompts that name it;
- **level name** — `levels/<name>.md`, `retro.bugLevels`;
- **skill or server** — its folder or file, the index entry, every attachment link.

Remove the same way: nothing may point at a removed item. After applying, rewrite each touched file
whole and run `validate.mjs`.
