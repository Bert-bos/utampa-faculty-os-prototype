# Closed-loop rollout

Status: repository instructions are current; external invocation and account-instruction compliance remain unproven until a linked exact-revision Claude result is recorded.

Goal: bring this repository onto the proven split-role Claude↔BOS GitHub workflow demonstrated in Bert-bos/project-x-classroom-os#3 without broadening Claude's write authority.

Acceptance:
- A bounded GitHub job is relayed to unattended Claude by the private BOS control plane. No repository-local Claude listener exists at this revision.
- Claude's recorded response identifies the exact base SHA, `CLAUDE-HANDOFF.md`, `docs/CLOSED-LOOP-STANDARD.md`, the allowed commands, and the requested output before reporting its result.
- Claude can run this repository's appropriate local validation command unattended, or explicitly prove that no such command exists and propose the smallest safe one.
- Claude can perform narrow read-only repository verification needed for closure.
- Claude returns a deterministic patch or no-change finding, commands, results, and blockers to the originating GitHub job.
- BOS independently verifies Claude's result and applies any authorized repository change.
- A linked result proves the communication loop only. Product work is complete only after the applicable exact-head, deployment-identity, source-correctness, and production gates pass.

Evidence still required:

- The originating GitHub job/comment and the returned Claude response.
- Exact base SHA and resulting SHA, if changed.
- Independent validation output.
- A concise blocker record when Claude could not complete the bounded task.
