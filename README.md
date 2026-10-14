# Paperclip booking-release rehearsal

Independent demonstration using synthetic data. No access to any client's code or Paperclip instance. Payments are not connected.

One small change to a private-session booking app, taken through a real Paperclip instance and a protected release on 14 October 2026. The defect was planted on purpose; this was a seeded engineering exercise, not a defect found in anyone's software.

**The operator role (Paperclip approvals, GitHub environment approvals and merges) was played by the build session through the operator account; no person reviewed these changes.** What the release gate proves still holds: a deployment did not pass without an approval tied to its run and commit.

Live page: https://theaipipe.com/demos/paperclip-booking-rehearsal/ (production app: `/app/`, staging: `/staging/`).

## The ticket, from request to production (times UTC, from git and GitHub timestamps)

**13:29 to 13:33. Baseline and requirement.** The baseline booking app (`b231851`, test-script fix `1d8db4b`) is written outside Paperclip. On top of `1d8db4b` the operator commits `app/tests/overlap.test.js` (`259df74`, 13:33): a 30-minute session must not start inside a 60-minute one, and simultaneous overlapping requests must confirm at most one. It fails 5 of its 6 cases. The [red CI run](https://github.com/fred1433/paperclip-booking-rehearsal/actions/runs/38575163046) was recorded at 13:50, when that commit was first pushed to GitHub; locally it failed at 13:33, before any fix.

**13:34. BOO-1 opens in Paperclip**, created by the operator user and assigned to the Implementer agent. The ticket holds the repository, branch, base commit, acceptance criteria, test command, constraints and next action. Its execution policy: review by the Reviewer agent, then approval by the operator user, at most two review rounds before escalating to that user.

**13:34 to 13:37. Implementer run.** It replaces "read, then insert" with one conditional statement (`INSERT ... SELECT ... WHERE NOT EXISTS` an overlapping confirmed booking), so the check and the write cannot be separated. No schema change, so the previous release still runs on the same database. Commit `13e6509`, 22 of 22 tests. It sets the ticket to done; Paperclip turns that into "in review" and assigns the Reviewer.

**In parallel on main.** The booking page and its two drills (`37d56fd`, 13:37:52) were built by the operator session on `main` while the Implementer was finishing; this is release A.

**13:37. The handoff stalls.** Paperclip skipped the Reviewer's wake-up: *"The previous execution has not released its environment lease."* The lease was released 81 ms later. Nothing retried. The ticket showed "in review" while nobody worked on it.

**13:38 to 13:40. Release A through the gate.** The release run for `37d56fd` deploys staging and stops at the protected production environment. A first request is rejected on purpose at 13:39:25: nothing is deployed. The re-run is approved through the operator account; A is live at 13:40:02. Its smoke step failed because of a bug in the operator's script (`curl | grep -q` under `pipefail`), fixed in `f503b2f` at 13:40.

**13:44. The operator re-wakes the Reviewer** (`POST /api/agents/{id}/wakeup` with the issue id), an unplanned intervention.

**13:46. Review: approved.** The Reviewer reran the tests, swept all 81 combinations of session lengths and offsets, and fired 300 rounds of 12 concurrent overlapping requests: no overlap. One non-blocking note (reusing a key for an overlapping request returns 409 rather than 422). It requested no changes, so no delivery was refused in this run.

**13:49. Approved in Paperclip through the operator account**, after the session's own checks: tests on a fresh checkout of the exported commit, five race rounds against a local D1 database (one booking confirmed each round), and the same race against release A on staging (three of three rounds double-booked). The decision comment lists them.

**13:50. Merge.** The operator session moves the commits out of the agents' container (git bundle), opens [pull request #1](https://github.com/fred1433/paperclip-booking-rehearsal/pull/1); tests pass; merged at 13:50:34 as release B (see "History rewrite" below for its id); staging deploys and passes its smoke test.

**13:51. Production waits.** The production job is held by the protected environment's approval gate. A's approval covered A's run only.

**13:52. Approved through the operator account; the fix is live** (13:52:15). Five race rounds on production: one booking confirmed each time.

**13:52 to 13:57. Rollback drill.** The first rollback run (13:52:45) failed at staging: the old commit carried the old smoke-test bug, because the workflow took its scripts from the release commit. The workflow was changed (13:54) to deploy the app from the release commit and run its tooling from its own commit. Back to A at 13:55:40 through the same gate, then forward to B at 13:57:45. Five bookings made under A, B and A again in a dedicated sandbox survived every step (`evidence/raw/rollback_*.json`). With A back, the race double-booked again, as it should.

**13:58 to 14:05. A second ticket, BOO-2, with a crash drill.** Tests that pin the slot list around the Paris clock change on 25 October 2026. The Implementer's process was killed on purpose (SIGKILL) while writing; the run failed at 13:59:21. Paperclip retried it on its own; the retry started at 14:00:03, about 40 seconds later, found the half-written test file, finished it and corrected one wrong expectation. The handoff to review stalled again exactly as on BOO-1 (43 ms race) and was re-woken by the operator session. Reviewed, approved in Paperclip, pushed as [pull request #2](https://github.com/fred1433/paperclip-booking-rehearsal/pull/2), left unmerged so the released commit stays fixed.

## Where the operator role was still needed

| | |
|---|---|
| Ticket to production (BOO-1) | 17 minutes (13:34:45 to 13:52:15) |
| Operator decisions | 2 approvals in Paperclip; 5 at the release gate, one a deliberate rejection; 1 merge |
| Unplanned interventions | 2 in Paperclip (both stalled handoffs); 2 in the release scripts (smoke test, rollback tooling) |
| Questions an agent asked to rebuild context | 0 |
| Agent runs | 5: four did their work and were then marked cancelled by Paperclip as the ticket moved on (one of them the automatic retry); one was killed on purpose (see `evidence/manifest.json`) |

## What Paperclip did, and what was done beside it

In this exercise Paperclip handled ownership, assignment, execution state, the review stage and the approval stage held by the operator user. Application correctness, deployment authorisation, smoke tests and data recovery were implemented or configured separately.

Set up outside Paperclip: the baseline app and its tests, the seeded test, the booking page, the GitHub environments and release workflow, the container, Paperclip onboarding and the company, agents, goal and tickets (through its API, as the operator user), moving commits out of the container, the pull requests, the merge and the release approvals. All of it is listed in `evidence/manifest.json`.

**The operator account.** In Paperclip, a user account created for this rehearsal ("Operator"); in GitHub, the repository owner's account. Both were driven by the build session. The Paperclip decision comments record what the session inspected; no person reviewed these changes.

## The release gate, exactly

- Production deployed only from a run approved in the protected `production` environment; each run is pinned to one commit, tests it, and refuses to deploy anything else. Admin bypass was off for production.
- The gate held the production job, not the only key. The staging job deployed on every push to `main` with the same Cloudflare token and no reviewer, and that token was account-wide, so it could have deployed production too. A real setup needs separate, narrowly scoped credentials per environment.
- Both deploy secrets were removed from the GitHub environments after the run (14:50 UTC). Later changes (the corrections listed below) were deployed by the build session from its own machine with `wrangler`, not through the gate.

## Corrections after the run

After an independent read-through, the build session changed, outside Paperclip and outside the release gate:
- the API now refuses a `start` without `Z` or a UTC offset, and answers 400 to an unknown time zone (it used to accept the first and fail with 500 on the second); two tests added;
- the page shows the drills first, reports "nothing was confirmed" when both requests are refused (for example in a full sandbox), and lays the days out in two rows;
- wording on this page and the landing page about who approved, about the release gate, and the timeline above.

## History rewrite

After the run, the git history was rewritten once to remove a third-party name from documentation files and to set the merge commit's author to "Operator". Commits up to `13e6509` keep their ids. Later ones changed; the app code did not:

| Old id (as deployed, and as shown on GitHub run pages) | New id | Note |
|---|---|---|
| `1772f30` | `287e6cf` | docs only |
| `7e4de34` (release B) | `db5931d` | same `app/` tree `9acb214` |
| `3f0b738` | `42f09fb` | release workflow fix |
| `8a6507d`, `d621d66` | `ad6c9e3`, `eb531ab` | docs and landing page |

GitHub run and deployment pages still show the old ids.

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
- `docs/LAUNCH_NOTES.md`: what a booking launch has to answer, from a public marketplace preview only.
- `landing/`: the page at the address above.
