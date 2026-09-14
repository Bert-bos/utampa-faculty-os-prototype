# Claude ↔ BOS closed-loop standard

Reference proof: Bert-bos/project-x-classroom-os#3.

Operating pattern:
1. BOS creates an exact, bounded GitHub job.
2. An `@claude` issue/PR comment wakes Claude through the default-branch GitHub workflow.
3. Claude works with repository contents read-only, using only explicitly allowlisted local/test/read commands.
4. Claude returns deterministic patch/evidence in GitHub.
5. BOS independently verifies and applies authorized repository writes.
6. CI and release verification remain independent of the implementer.
7. Revisions return through GitHub; Bert is not the routine courier.
8. Merge, deploy, spending, sensitive-data access, and requirement changes remain behind their normal approval boundaries.

Do not grant Claude broad repository-write authority merely to remove a handoff; preserve separation of duties.
