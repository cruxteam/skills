# Maintaining this repository

This repo is the public `crux` plugin. Four runners install it from the same files:

| Runner | Reads |
|---|---|
| Claude Code, Codex, GitHub Copilot CLI, VS Code | `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`, skills from `skills/` |
| Gemini CLI | `gemini-extension.json`, skills from `skills/` |

Keep the root free of `CLAUDE.md`: a plugin root's `CLAUDE.md` is not loaded and
`claude plugin validate --strict` rejects it.

## Skills

- Flat layout: `skills/<name>/SKILL.md`. The directory name, the frontmatter `name` and the
  `crux-` prefix agree. Copilot, VS Code and Gemini show skills without the plugin namespace,
  so a bare name such as `run` would collide with other skills and built-in commands.
- Frontmatter: `name`, `description`, `argument-hint`. Codex and Gemini read only `name` and
  `description`, so nothing a skill needs may live elsewhere in the frontmatter.
- Every skill has `agents/openai.yaml` (Codex picker metadata: `interface.display_name`,
  `interface.short_description`). A skill only the user may start also sets
  `disable-model-invocation: true` and `policy.allow_implicit_invocation: false`, both together.
- Write for every runner. Name a runner-specific tool together with what to do without it
  (`start_session` only exists in Claude Desktop; `EnterWorktree` only in Claude Code; Codex has
  no question tool outside Plan mode).
- Scripts are POSIX `sh`, run as `sh <this skill's directory>/scripts/<file>`, with no
  dependencies beyond git. Skills refer to them by that relative path; the tests check the
  paths resolve. The one exception is `skills/crux-config/scripts/validate.mjs`: a bundle
  generated in the CRUX monorepo that runs on `bun` or `node`. Never edit it by hand; the
  README (*Republishing `validate.mjs`*) says how to rebuild it.
- A skill is a folder with a `SKILL.md`. `skills/crux-config/` holds only its validator until
  its `SKILL.md` lands.
- `crux-dispatch` and `crux-run` carry the same bootstrap word for word, with no single quote in it
  (it is printed inside single quotes), and name the tracker claim error codes. The tests
  enforce both.
- Never ship an MCP server config: each project owns its crux entry (see the README).

## Release

1. Bump `version` in `.claude-plugin/plugin.json`, `gemini-extension.json` and `package.json`,
   and add a `CHANGELOG.md` section. Codex and Copilot reinstall only when that version changes.
2. `bun test` and `claude plugin validate . --strict`.
3. Merge to `main`, then publish a GitHub release tagged `v<version>`: once a repo has
   releases, Gemini CLI installs and updates from the latest release only.
