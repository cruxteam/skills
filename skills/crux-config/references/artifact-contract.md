# Artifact contract

Every PIPELINE agent posts exactly one kind of artifact; a CHAT agent may post one. The name is the
agent's `artifact` field in `agent.yaml` (`{{agent.artifact}}` in its prompts): one path segment
(no `/` or `\`, not `.` or `..`), lower-case words joined by `-`, unique in the workflow.
`review-report` is the name the retro reads as a review by default; give it only to an agent that
reviews.

## The comment

An artifact is one tracker comment, posted with `comment_create` only after the person approved
its draft in the chat:

```markdown
### 📦 ARTIFACT: <name> v<n>

- agent: <agent> · skill: <skill or none>
- consumes: <upstream artifact names, or "ticket description">
- approved-by: human-in-chat, <YYYY-MM-DD>

***

<the body: the agent's own sections>

## ⚠️ Gaps

<what could not be confirmed, each with what would confirm it; "none" when there is nothing>
```

- `v<n>` starts at 1; a revised artifact is a new comment with the next number, never an edit.
- `consumes` names what the agent read, so a reader can trace every item to its source.
- The body quotes the request or the upstream artifact for every derived item and copies ids,
  paths and numbers verbatim.

## Upstream artifacts

An agent that builds on another agent's work reads that artifact from the ticket's comments
(`ticket_get`) by its header, newest version first. S6 records, per agent, which upstream
artifacts it reads; the critic flags a name no agent of the workflow produces.
