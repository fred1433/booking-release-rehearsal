# Paperclip booking-release rehearsal

Independent demonstration using synthetic data. No access to any client's code or Paperclip instance. Payments are not connected.

**The operator role (Paperclip approvals, GitHub environment approvals and merges) was played by the build session through the operator account; no person reviewed these changes.**

Live page: https://theaipipe.com/demos/paperclip-booking-rehearsal/ (production app `/app/`, staging `/staging/`).

## Summary

- **What ran.** A real Paperclip instance (2026.1012.0) with two agents (Implementer, Reviewer) and an operator user took three tickets on a small booking app: BOO-1 fixed a double-booking defect planted on purpose, BOO-2 pinned behaviour around a clock change, BOO-3 fixed two defects found later by an external review.
- **What held.** Review and approval stages were enforced by Paperclip every time. Overlapping requests confirm at most one booking, at the write. A retry with the same key returns the original booking. A rollback A → B → A → B kept every booking.
- **What failed, and its status.** Every handoff from Implementer to Reviewer was skipped by Paperclip (3 of 3: 81, 43 and 95 ms races with the release of the previous run's workspace lease). On BOO-1 and BOO-2 the operator session had to wake the reviewer by hand. On BOO-3 a small reconciler running beside Paperclip woke it once, 11 seconds after the handoff, with no person or session involved. The reconciler's fallback (one blocker issue when the retry starts nothing) is covered by unit tests, not exercised live.
- **What the release gate proved, and what it did not.** The recorded production job waited for an approval tied to its run and commit, and a rejected request deployed nothing. This rehearsal did **not** restrict every production-capable credential to that job: the staging job held the same account-wide Cloudflare token without a reviewer.
- **What you are clicking.** The app on the page is a later build, deployed locally by the build session after the recorded run and outside the gate (see "Builds" below).

## Phases

1. **Requirement first.** Each ticket starts from a test written before the fix, failing on `main`.
2. **Implementation in Paperclip.** The Implementer runs in an isolated container, commits on a branch, sets the ticket to done; Paperclip routes it to review.
3. **Review and approval.** The Reviewer approves or asks for changes (it never asked for changes in this run); the operator user approves after its own checks, which it records in the decision comment.
4. **Release.** Commits leave the container as a git bundle; tests; staging; production behind the GitHub environment approval (first run only).
5. **Rollback drill.** A → B → A → B through the same gate, with bookings kept.

The full trace with times is below, after the evidence list.

## Builds

| | Commit | How it was deployed |
|---|---|---|
| Release A (seeded defect) | `37d56fd` | release workflow, approved at the gate, 13:40 UTC |
| Release B (BOO-1 fix) | app code `db5931d` here, built as `7e4de34` in the working repository | release workflow, approved at the gate, 13:52 UTC; rolled back and forward at 13:55 and 13:57 |
| Current demo build | shown live beside the app (`/app/api/health`) | deployed locally by the build session with `wrangler`, outside the gate, after the deploy secrets were removed (14:50 UTC) |

The current build adds, after the recorded release: BOO-3 (through Paperclip), and, outside Paperclip, the page fixes listed under "Corrections after the run".

## About this repository

This repository was republished on 14 October 2026 from a private working repository. GitHub run, pull request, approval and deployment pages from that repository are not public; their data is exported in `evidence/github/github-record.json`. Commit `7e4de34` named there is the working-repository id of release B; its `app/` tree is the same as `db5931d` here.

## The release gate, exactly

- The production job ran only from an approved run in the protected `production` environment (admin bypass off). Each run is pinned to one commit, tests it, and deploys only that commit. A first request was rejected on purpose: nothing was deployed. The fix later waited for its own approval although the previous release had been approved.
- The staging job deployed on every push to `main` with the same Cloudflare token, without a reviewer (admin bypass on). That token was account-wide, so the staging job could have deployed production. A real setup needs a staging credential that cannot modify production resources, and a test that proves it.
- Both deploy secrets were removed after the run (14:50 UTC) and the workflow's push trigger is now off. Everything deployed since then was deployed locally by the build session.

## The handoff reconciler

`scripts/handoff-reconciler.mjs` runs beside Paperclip with the operator account. For an issue in review whose reviewer is an agent:

1. it does nothing while any run on the issue is active or any of its workspace leases is held;
2. it does nothing if the reviewer already started a run after the handoff;
3. otherwise, 10 seconds after the last run finished, it wakes the reviewer **once** per review round and says so on the issue;
4. if no review run starts within 3 minutes, it opens **one** blocker issue for the accountable person and stops.

Live on BOO-3: wake-up skipped at 14:59:49.735, lease released at 14:59:49.830, reconciler woke the reviewer at 15:00:00.8, one review run started at 15:00:00.9 (log: `evidence/raw/handoff_reconciler.log`; the comment it left is in the exported record). Unit tests (`app/tests/handoff-reconciler.test.js`) cover: one wake per round, no wake during an active run or a held lease or the grace period, no second reviewer, one blocker after a failed retry, a fresh retry for a new review round.

## Where the operator role was still needed

| | |
|---|---|
| Ticket to production (BOO-1) | 17.5 minutes (13:34:45 to 13:52:15) for one seeded ticket with an automated operator; not a measure of human effort or a delivery average |
| Approval and rejection decisions | 3 approvals in Paperclip; 5 at the release gate (one a deliberate rejection) |
| Merges | 1 pull-request merge on GitHub (BOO-1); BOO-3 merged locally |
| Unplanned interventions | 2 manual re-wakes in Paperclip (BOO-1, BOO-2); 2 fixes to release scripts (smoke test, rollback tooling). BOO-3's skipped handoff was recovered by the reconciler |
| Questions an agent asked to rebuild context | 0 |

## Full trace (times UTC, from git, GitHub and Paperclip timestamps)

**13:29 to 13:33. Baseline and requirement.** Baseline app `b231851`, test-script fix `1d8db4b`, both outside Paperclip. On top of `1d8db4b` the operator commits `app/tests/overlap.test.js` (`259df74`, 13:33): a 30-minute session must not start inside a 60-minute one, and simultaneous overlapping requests confirm at most one. It fails 5 of its 6 cases locally at 13:33; the red CI run was recorded at 13:50, when the commit was first pushed.

**13:34. BOO-1 opens in Paperclip**, created by the operator user, assigned to the Implementer, with repository, branch, base commit, acceptance criteria, test command, constraints and next action. Execution policy: review by the Reviewer agent, then approval by the operator user; at most two review rounds before escalating to the issue's responsible user (or, without one, its creator).

**13:34 to 13:37. Implementer run.** Replaces "read, then insert" with one conditional statement (`INSERT ... SELECT ... WHERE NOT EXISTS` an overlapping confirmed booking). No schema change. Commit `13e6509`, 22 of 22 tests. Paperclip turns "done" into "in review".

**In parallel on main.** The booking page and its drills (`37d56fd`, 13:37:52), built by the operator session: release A.

**13:37. The handoff stalls.** The Reviewer's wake-up is skipped: *"The previous execution has not released its environment lease."* The lease is released 81 ms later; nothing retries.

**13:38 to 13:40. Release A through the gate.** Staging deploys; production waits; a first request is rejected on purpose at 13:39:25 and nothing is deployed; the re-run is approved and A is live at 13:40:02. Its smoke step fails on a bug in the operator's script (`curl | grep -q` under `pipefail`), fixed in `f503b2f`.

**13:44. The operator session re-wakes the Reviewer** by hand.

**13:46. Review approves.** The Reviewer reran the tests, swept 81 combinations of lengths and offsets, and reported 300 rounds of 12 concurrent overlapping requests on the SQLite-backed local test stand-in (not on production): no overlap. No changes requested.

**13:49. Approved in Paperclip through the operator account**, after the session's checks: tests on a fresh checkout, five race rounds against a local D1 database, the same race against release A on staging (three of three double-booked).

**13:50 to 13:52. Merge and release B.** Commits leave the container as a git bundle; pull request; tests; merged at 13:50:34; staging; production waits for its own approval; approved; live at 13:52:15. Five race rounds on production: exactly one booking each.

**13:52 to 13:57. Rollback drill.** The first rollback run failed at staging: the old commit carried the old smoke-test bug, because the workflow took its scripts from the release commit. Fixed so tooling comes from the workflow's own commit. Back to A at 13:55:40, forward to B at 13:57:45. Five bookings made under A, B and A again survived. With A back, the race double-booked again: the rollback is schema-compatible, not booking-safe.

**13:58 to 14:05. BOO-2, crash drill.** Tests around the Paris clock change on 25 October 2026. The Implementer's process is killed on purpose (run failed 13:59:21); Paperclip retries on its own (retry started 14:00:03, about 40 seconds later); the retry finishes the half-written file and corrects one wrong expectation. The handoff stalls again (43 ms); the operator session re-wakes the reviewer. Approved; not merged into the released commit.

**14:50. Deploy secrets removed** from both GitHub environments.

**14:56 to 15:03. BOO-3, real defects and the reconciler.** An external review found that a retry after the one-hour cutoff was refused, and that concurrent requests could push a sandbox past its 40-booking limit. Requirement test `143ee46` (3 of 4 cases failing). Implementer commit `f62a312`: structural checks, then the idempotency lookup, then the moving eligibility rules; the limit moves into the same conditional INSERT as the overlap test. The handoff stalls a third time (95 ms); the reconciler wakes the reviewer once, 11 seconds later; one review run; approved; approved in Paperclip through the operator account at 15:03:30; merged locally (`609943a`).

## Corrections after the run (outside Paperclip and outside the gate)

- The API refuses a `start` without `Z` or a UTC offset, and answers 400 to an unknown time zone (it used to book the first at UTC and fail with 500 on the second).
- The booking page keeps one pending request with a stable key: if a reply is lost after the server committed, it retries the same request and shows the original booking, and its buttons always come back (`scripts/e2e/booking_page.py`).
- A slow reply for an earlier day or length is dropped before it touches the grid (same file).
- The drills report "nothing was confirmed" when every request is refused.
- `scripts/race.mjs` takes `--expect fixed|defect` and exits 1 on unexpected statuses, zero winners or more than one stored booking (`app/tests/race-script.test.js`). The release smoke test only checks the build id, the page and the config; it does not prove that bookings work.
- The exporter ships its database helper and limits its database reads to one company.

Each of these has a test that failed against the earlier code.

## Not covered

- Requesting a time, payments, more than one currency, notifications, expiry of old demo sandboxes.
- Database restore and external side effects. Bookings taken while the old code was back are not rechecked by the fix.
- The overlap guarantee holds for the code path that writes bookings; other code writing to the same table could bypass it.
- One synthetic teacher, one transaction currency (AUD, simulated).

## Cost

No incremental model API charges during these recorded runs. The agents used an existing paid Claude Code subscription; extra usage was disabled on that account, checked before and after each run (`evidence/raw/subscription_usage.json`). Paperclip's cost figures are estimates, not the provider's bill.

## Machine safety

Paperclip and its agents ran in a container (`paperclip/Dockerfile`, Paperclip 2026.1012.0 and Claude Code 2.1.299 pinned) holding only this repository: no deploy key, no GitHub credentials, no git remote, nothing mounted from the host. The `claude_local` adapter ran on the CLI engine with permission prompts skipped, which is why the box matters.

## Evidence

- `evidence/paperclip-record.json`: tickets, comments, activity, runs, wake-up requests, review and approval decisions, workspace leases, for this company only. API reads plus three database reads (`scripts/export_record.py`, `scripts/pg-query.mjs`), scrubbed by pattern; read before publishing.
- `evidence/github/github-record.json`: runs, jobs, approvals, deployments, pull requests and environment settings of the working repository.
- `evidence/manifest.json`: versions, adapter settings, ids, interventions, setup done outside Paperclip.
- `evidence/raw/`: gate states, race results, rollback snapshots, reconciler log, browser checks, subscription usage.

## Check it yourself

```sh
cd app && npm test                                   # Node 24+
node scripts/race.mjs https://theaipipe.com/demos/paperclip-booking-rehearsal/app/api 5 --expect fixed
python scripts/e2e/booking_page.py https://theaipipe.com/demos/paperclip-booking-rehearsal/app/   # Playwright
```

## Repository map

- `app/`: the booking app (Cloudflare Worker + D1). `src/booking.js` writes bookings; `src/time.js` handles time zones and clock changes; `tests/`.
- `scripts/`: race check, browser checks, handoff reconciler, record exporter.
- `.github/workflows/`: tests on every push; `release.yml` as used in the recorded run (now manual only).
- `paperclip/Dockerfile`: the isolated runtime.
- `PLAYBOOK.md`, `docs/FIRST_48_HOURS.md`, `docs/LAUNCH_NOTES.md`.
- `landing/`: the page at the address above.
