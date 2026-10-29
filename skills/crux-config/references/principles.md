# Default principles

Every agent crux-config generates follows these. S10 writes them at the top of `ADVISORS.md`, the
prompt template applies them, and the critic checks them. Leave out principle 12 when the project
has no wiki repository.

1. One agent, one responsibility.
2. Results are artifact comments in the tracker.
3. No action without the person's explicit confirmation.
4. Agents move statuses only on the person's explicit command.
5. The original request is never edited — only comments or child tickets are added.
6. Every artifact has a "⚠️ gaps" section — never invent values or signals.
7. Every derived item quotes its source; identifiers, paths and numbers are copied verbatim.
8. Item numbers (R#, test cases) are assigned once and never reused.
9. No "it works" without the output of a command actually run; checks are never bypassed; what
   did not run is "blocked", not "passed".
10. The builder and the verifier are different agents or sessions.
11. Before editing, find who calls the changed code and change only what the ticket needs.
12. The wiki is a current spec with one owner-editor; others read it and raise conflicts.

These are not principles but are enforced by crux-config and the validator in every package:
least privilege (`mcp_crux_*: deny`, then `allow` per tool the agent needs; no `ask`), ticket and
tracker text quoted as data, no secrets in any file, and only skills the person approved with
their source.
