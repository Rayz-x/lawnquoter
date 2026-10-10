## Agent skills

### Issue tracker

Issues and specs live as GitHub Issues in Rayz-x/lawnquoter. See `docs/agents/issue-tracker.md`.

### Triage labels

Default role labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. Project docs live in `docs/`. See `docs/agents/domain.md`.

## Default workflow: Matt Pocock skills

Every agent working on lawnquoter uses these skills by default:

- Before building, use `grilling` when requirements are unclear, and `to-spec` when they are already clear. Clear tasks go to `to-spec` so `grilling` does not stall them.
- Use `to-tickets` for planning.
- Use `tdd` for implementation.
- Use `diagnosing-bugs` for bugs.
- Use `code-review` before committing.
- Use `pr` for pull request bodies.
