# Paperclip booking-release rehearsal

Independent demonstration using synthetic data. No access to any client's code or Paperclip instance. Payments are not connected.

One small change to a private-session booking app, taken through a real Paperclip instance and a protected release on 14 October 2026. The defect was planted on purpose; this was a seeded engineering exercise, not a defect found in anyone's software.

Live page: https://theaipipe.com/demos/paperclip-booking-rehearsal/ (production app: `/app/`, staging: `/staging/`).

## The ticket, from request to production (times UTC)

**13:33. The requirement comes first.** On top of a baseline booking app (`37d56fd`, written outside Paperclip), the operator commits `app/tests/overlap.test.js` (`259df74`): a 30-minute session must not start inside a 60-minute one, and simultaneous overlapping requests must confirm at most one. It fails 5 of its 6 cases on the baseline ([red run](https://github.com/fred1433/paperclip-booking-rehearsal/actions/runs/38575163046)).

**13:34. BOO-1 opens in Paperclip**, created by the operator user and assigned to the Implementer agent. The ticket holds the repository, branch, base commit, acceptance criteria, test command, constraints and next action. Its execution policy: review by the Reviewer agent, then approval by the operator user, at most two review rounds before escalating to that user.

**13:34 to 13:37. Implementer run.** It replaces "read, then insert" with one conditional statement (`INSERT ... SELECT ... WHERE NOT EXISTS` an overlapping confirmed booking), so the check and the write cannot be separated. No schema change, so the previous release still runs on the same database. Commit `13e6509`, 22 of 22 tests. It sets the ticket to done; Paperclip turns that into "in review" and assigns the Reviewer.

**13:37. The handoff stalls.** Paperclip skipped the Reviewer's wake-up: *"The previous execution has not released its environment lease."* The lease was released 81 ms later. Nothing retried. The ticket showed "in review" while nobody worked on it.

**13:44. The operator re-wakes the Reviewer** (`POST /api/agents/{id}/wakeup` with the issue id). This was the one unplanned intervention inside Paperclip on BOO-1.

**13:46. Review: approved.** The Reviewer reran the tests, swept all 81 combinations of session lengths and offsets, and fired 300 rounds of 12 concurrent overlapping requests: no overlap. One non-blocking note (reusing a key for an overlapping request returns 409 rather than 422). It requested no changes, so no delivery was refused in this run.

**13:49. Approved in Paperclip by the operator account**, after its own checks: tests on a fresh checkout of the exported commit, five race rounds against a local D1 database (one booking confirmed each round), and the same race against the old release on staging (three of three rounds double-booked). The decision comment lists them.

**13:50. Release path, outside Paperclip.** The operator moves the commits out of the agents' container (git bundle), opens [pull request #1](https://github.com/fred1433/paperclip-booking-rehearsal/pull/1); tests pass; merged as `7e4de34`; staging deploys and passes its smoke test.

**13:51. Production waits.** The production job runs in a protected GitHub environment that holds the only deploy key. Release A had been approved at 13:39 for its own run; that did not cover this one. (At 13:39 a first request for A had been rejected on purpose, and nothing was deployed.)

**13:52. Approved by the operator account; the fix is live.** Five race rounds on production: one booking confirmed each time.

**13:55 and 13:57. Rollback drill.** Back to A through the same gate, then forward to B. Five bookings made under A, B and A again in a dedicated sandbox survived every step (`evidence/raw/rollback_*.json`). With A back, the race double-booked again, as it should. The first rollback attempt failed at staging: the old commit carried an old smoke-test bug, because the workflow took its scripts from the release commit. It now deploys the app from the release commit and runs its tooling from its own commit (`3f0b738`).

**13:58 to 14:05. A second ticket, BOO-2, with a crash drill.** Tests that pin the slot list around the Paris clock change on 25 October 2026. The Implementer's process was killed on purpose (SIGKILL) while writing. Paperclip marked the run failed and retried it 30 seconds later; the retry found the half-written test file, finished it and corrected one wrong expectation. The handoff to review stalled again exactly as on BOO-1 (43 ms race) and was re-woken by the operator. Reviewed, approved in Paperclip, pushed as [pull request #2](https://github.com/fred1433/paperclip-booking-rehearsal/pull/2), left unmerged so the released commit stays fixed.

## Where a person was still needed

| | |
|---|---|
| Ticket to production (BOO-1) | 17 minutes (13:34:45 to 13:52:15) |
| Planned human decisions | 2 approvals in Paperclip; 5 in the release gate, one a deliberate rejection |
| Unplanned interventions | 2 in Paperclip (both stalled handoffs); 2 in the release scripts (smoke test, rollback tooling) |
| Questions an agent asked to rebuild context | 0 |
| Agent runs | 5: four did their work and were then marked cancelled by Paperclip as the ticket moved on (one of them the automatic retry); one was killed on purpose (see `evidence/manifest.json`) |

## What Paperclip did, and what was done beside it

In this exercise Paperclip handled ownership, assignment, execution state, the review stage and the human approval stage. Application correctness, deployment authorisation, smoke tests and data recovery were implemented or configured separately.

Set up outside Paperclip: the baseline app and its tests, the seeded test, the GitHub environments and release workflow, the container, Paperclip onboarding and the company, agents, goal and tickets (through its API, as the operator user), moving commits out of the container, the pull requests and the release approvals. All of it is listed in `evidence/manifest.json`.

**The human account.** Approvals in Paperclip and in GitHub were given by the operator account: in Paperclip a real user account created for this rehearsal, in GitHub the repository owner's account, both operated for this rehearsal. Each decision records what was inspected.

## Not covered

- Requesting a time instead of booking instantly, payments, more than one currency, notifications.
- Rollback covered code only. Database restore and external side effects were not exercised, and bookings taken while the old code was back were not rechecked by the fix.
- One synthetic teacher, one transaction currency (AUD, simulated).

## Cost

No incremental model API charges during this recorded run. The agents used an existing paid Claude Code subscription; extra usage was disabled on that account, checked before and after (`evidence/raw/subscription_usage.json`). Paperclip's cost figures are estimates, not the provider's bill.

## Machine safety

Paperclip and its agents ran in a container (`paperclip/Dockerfile`, Paperclip 2026.1012.0 and Claude Code 2.1.299 pinned) holding only this repository: no deploy key, no GitHub credentials, no git remote, nothing mounted from the host. The `claude_local` adapter ran on the CLI engine with permission prompts skipped, which is why the box matters.

## Evidence

- `evidence/paperclip-record.json`: tickets, comments, activity, runs, wake-up requests, review and approval decisions, workspace leases. Exported through the Paperclip API (`scripts/export_record.py`), read-only, scrubbed for secrets and home paths. Paperclip's own company export leaves out approvals, costs and the activity log, so it was not used.
- `evidence/manifest.json`: versions, adapter settings, run, issue, decision and commit ids, GitHub runs and deployments, interventions, setup done outside Paperclip.
- `evidence/raw/`: gate states, race results, rollback drill snapshots, subscription usage.

## Check it yourself

```sh
cd app && npm test                                   # Node 24+
node scripts/race.mjs https://theaipipe.com/demos/paperclip-booking-rehearsal/app/api 5
curl https://theaipipe.com/demos/paperclip-booking-rehearsal/app/api/health
```

## Repository map

- `app/`: the booking app (Cloudflare Worker + D1). `src/booking.js` is where bookings are written; `src/time.js` handles time zones and clock changes; `tests/`.
- `.github/workflows/`: tests on every push; `release.yml` for staging, production and rollback.
- `paperclip/Dockerfile`: the isolated runtime.
- `PLAYBOOK.md`: how a team runs the next ticket this way.
- `docs/FIRST_48_HOURS.md`: joining an existing Paperclip setup.
- `docs/LAUNCH_NOTES.md`: what a booking launch has to answer, from a public preview page only.
- `landing/`: the page at the address above.
