# Diagnostics: bindings, activation, levels and labels

CRUX adapts to the tracker as the team runs it. It never creates a tracker project or status and
never asks anyone to change a tracker admin setting.

## Flows and statuses

- A flow is a `roleFlows` key, named after a tracker status. When the workflow activates, each
  flow binds to the status of the same name; a flow with no such status stays **unbound** and its
  pipeline lane is inert (its chat agents still answer by role).
- `workflow_readiness` lists `unboundFlows`, each with its `candidates` and a `proposal` by group.
  Bind with `flow_bind {flow, tracker_status}`, or take every proposal with
  `{accept_proposals: true}`; the dashboard's Workflow page does the same.
- A flow bound to a status of another group than its `expectedGroup` is a warning
  (`groupMismatches`), not a block. So is `noEntryStatus`: no flow expects the `backlog` group,
  so new tickets stay in the tracker's initial status.
- **GitHub without a Project:** there are no tracker statuses (`config_context.tracker.statuses`
  is null). S3 asks for the list; activation creates one `S:<status>` label per flow — the one
  thing CRUX creates in a tracker.

## Activation

- A project is activated in the dashboard (`/setup`); it needs only a tracker connection whose last
  test passed. A code repository, a workflow and a wiki are optional. Until the project is active
  the MCP server refuses every tool.
- Without a workflow the ticket tools work and the pipeline tools answer `WORKFLOW_REQUIRED`.
- A pending version (from crux-config) activates when its PR merges with the same `.crux/` tree;
  a merge with other `.crux/` changes waits for an admin to confirm it in the dashboard.
  `lastCheck.outcome` says what the last check found: `not_merged`, `merged_equal`,
  `merged_changed`, `pr_closed`, `branch_gone`, `fetch_failed`, `invalid` (see
  `activationError`), `stale` (a dashboard save moved past it), `activated`.
- `trackerSyncPending`: the last activation could not write the tracker side as the person it
  acted for; the next admin read or import runs it.

## Levels

A level uses the tracker's own issue or work-item type of the same name where one exists. Where
none does, CRUX carries the level as an `LV:<level>` label, made the first time a ticket needs it;
`unmappedLevels` and the warning "no native issue type is mapped to level …" say which. Nobody
creates these labels by hand.

## Estimates

With `estimates: on`, the scale is the tracker's own (Jira story points, a Linear team's scale)
when it has one, else `estimateScale`. Where the tracker has no estimate field, CRUX writes an
`EST:<n>` label. With `estimates: off` (or no workflow) the estimate tools answer
`ESTIMATES_DISABLED`.

## Skills and MCP servers

- `notExposedLocally` — a skill in `.crux/skills/` no local AI tool's native skill folder links
  to; local WORKER agents will not see it.
- `missingSkills`, `missingMcpFiles` — an index entry or attachment with no files; a warning.
- `missingSecrets` — an MCP server's `${VAR}` without a value; enter it in the dashboard.
