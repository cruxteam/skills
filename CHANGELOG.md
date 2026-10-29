# Changelog

## Unreleased

- `skills/crux-config/scripts/validate.mjs`: the offline `.crux/` validator, built from the CRUX
  rules (rules version 4). The `crux-config` skill that runs it comes later.

## 0.2.0 — 2026-10-20

- New skill `crux-retro`: a retrospective over a sprint, a `--from/--to` date range or the last
  7 days, following the project's retro instructions from CRUX, with optional paired A/B
  benchmarks, recommendations picked by number and turned into tickets, and the retro saved to
  the project's `/retrospective` page.

## 0.1.0 — 2026-10-19

- First release: `crux-dispatch`, `crux-run` and `crux-worktree`, installable as the `crux` plugin
  in Claude Code, Codex, GitHub Copilot (CLI and VS Code) and as a Gemini CLI extension.
