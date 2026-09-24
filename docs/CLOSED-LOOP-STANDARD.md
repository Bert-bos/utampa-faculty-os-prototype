# Claude ↔ BOS closed-loop standard

Reference proof: Bert-bos/project-x-classroom-os#3.

## Current wiring and proof boundary

This repository has no `.github/workflows/claude.yml` at the current revision. Commit `09ddb09749d6dd5d46b14c2b08a6985be6114881` removed the repository-local listener to route Claude work through the private BOS control plane. Therefore an `@claude` comment is not, by itself, evidence that Claude was invoked. Closure requires a linked GitHub response or control-plane result tied to the exact repository revision.

Repository contents also cannot reveal or verify Bert's private Claude account instructions. Per-job compliance must be demonstrated in Claude's recorded response and then independently checked by BOS. Do not state that account-level instructions were verified from this repository.

Operating pattern:
1. BOS creates an exact, bounded GitHub job.
2. The private BOS control plane invokes Claude and returns the result to the same GitHub job; the repository does not provide its own Claude listener.
3. Claude records the exact base SHA, instruction files, task boundary, and allowed commands before reporting work.
4. Claude works with repository contents read-only, using only explicitly allowlisted local/test/read commands.
5. Claude returns a deterministic patch or no-change finding, commands run, test results, and unresolved blockers in GitHub.
6. BOS independently verifies the result, applies authorized repository writes, and reruns the applicable gates against the resulting exact SHA.
7. If a gate fails, BOS and Claude continue the correction loop; Bert is not the routine courier or tester.
8. CI, source-correctness checks, deployment identity, and production verification remain independent of the implementer.
9. Merge, deploy, spending, sensitive-data access, new credentials/scopes, and requirement changes remain behind their normal approval boundaries.

Do not grant Claude broad repository-write authority merely to remove a handoff; preserve separation of duties.

Minimum closure evidence:

- GitHub job/comment URL and timestamp.
- Exact base SHA and the instruction sources Claude acknowledged.
- Deterministic patch or explicit no-change rationale.
- Commands and results, including failures.
- Independent BOS verification at the resulting exact SHA.
- For a release task, deployment ID, live revision, rollback target, and production checks; a closed-loop smoke test alone is not a product release.
