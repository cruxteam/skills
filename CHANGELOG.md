# Changelog

## 0.3.0 — 2026-10-30

- New skill `crux-config`: configures a project's workflow by interview and ships `.crux/`
  through a PR, or a direct import without a code repository. Preflight bootstraps the
  project's `.mcp.json` crux entry; `scripts/config-branch.sh` keeps one
  `crux-config/<projectKey>` branch per project and never force-pushes.
- Stage agents `crux:config-product` … `crux:config-retro` (S1–S11) and `crux:config-critic`: each
  interviews for one stage of `crux-config` and answers JSON (`references/stage-contract.md`);
  the critic checks the default principles, references, ADVISOR skill fit, least privilege,
  tracker-write tools, artifacts and quoted data.
- `skills/crux-config/scripts/validate.mjs`: the offline `.crux/` validator, built from the CRUX
  rules (rules version 4); `crux-config` runs it after every write.

## 0.2.0 — 2026-10-20

- New skill `crux-retro`: a retrospective over a sprint, a `--from/--to` date range or the last
  7 days, following the project's retro instructions from CRUX, with optional paired A/B
  benchmarks, recommendations picked by number and turned into tickets, and the retro saved to
  the project's `/retrospective` page.

## 0.1.0 — 2026-10-19

- First release: `crux-dispatch`, `crux-run` and `crux-worktree`, installable as the `crux` plugin
  in Claude Code, Codex, GitHub Copilot (CLI and VS Code) and as a Gemini CLI extension.
