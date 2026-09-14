# Closed-loop rollout

Status: in progress.

Goal: bring this repository onto the proven split-role Claude↔BOS GitHub workflow demonstrated in Bert-bos/project-x-classroom-os#3 without broadening Claude's write authority.

Acceptance:
- `@claude` issue comment wakes unattended Claude.
- Claude can run this repository's appropriate local validation command unattended, or explicitly prove that no such command exists and propose the smallest safe one.
- Claude can perform narrow read-only repository verification needed for closure.
- Claude returns deterministic patch/evidence to GitHub.
- BOS remains the independent repository-write/release authority.
- No merge/deploy/production change is required to prove the loop.
