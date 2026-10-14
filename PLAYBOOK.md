# Playbook: running the next ticket this way

Plain-English steps for a team that wants each piece of agent work to have an owner, the right context, a reliable handoff and a safe release. Written from this rehearsal on Paperclip 2026.1012.0. Check the details again on a newer version.

## 1. Before the first ticket

- **One accountable person per flow.** In Paperclip this is a real user account, set as the issue's responsible user. Review loops that run out of rounds escalate to that person; without one, Paperclip hands the work back to the agent again.
- **Decide where agents run.** The Claude Code adapter skips permission prompts by default (it has to, nobody is there to click). So give agents a box that holds only what they need: here, a container with one repository, no deploy key, no GitHub token, nothing from the host.
- **Pick the adapter engine on purpose.** `claude_local` defaults to the ACP engine. This run set `engine: "cli"` so the agents use the official Claude Code command line. Write down which one you use.
- **Keep releases outside the agents' reach.** Paperclip decides when a ticket is done. A separate release gate decides what reaches production (here, a protected GitHub environment holding the only deploy key).
- **Two agents are enough to start.** An Implementer and a Reviewer. Add another only when it removes more supervision than it adds.

## 2. Write the ticket so nobody has to ask

Every ticket in this run used the same five headings. Neither agent asked the operator a single question.

```
## Context        repository, branch, base commit, where the code lives
## Problem        what is wrong, in two or three sentences
## Acceptance     numbered, testable; include the test command
## Constraints    what must not happen (no push, no deploy, no new dependency)
## Next action    who does what next
```

If a fact lives only in someone's head, it is missing from the ticket.

## 3. Set the execution policy, then check it

On the issue:

```json
{
  "mode": "normal",
  "commentRequired": true,
  "maxReviewRounds": 2,
  "stages": [
    { "type": "review",   "participants": [{ "type": "agent", "agentId": "<reviewer>" }] },
    { "type": "approval", "participants": [{ "type": "user",  "userId":  "<accountable person>" }] }
  ]
}
```

Then read the issue back and confirm both stages and participants are there. Paperclip drops participants that lack an id, and a stage with nobody in it disappears. One approval per stage: two people in one stage does not mean two sign-offs.

## 4. While it runs, watch the right things

- **The board is not enough.** In this run, both handoffs from Implementer to Reviewer stalled: Paperclip skipped the Reviewer's wake-up because the previous run had not released its workspace yet (by 81 and 43 milliseconds). Nothing retried. The ticket said "in review" while nobody worked on it.
- **Check for skipped wake-ups** after every handoff: the wake-up list shows `skipped` with the reason. If one is skipped, wake the agent with the issue id:
  `POST /api/agents/<reviewer>/wakeup {"source":"assignment","reason":"execution_review_requested","payload":{"issueId":"<issue>"}}`
- **Mentions do not wake agents** (since 2026.1005). Assignment and review requests do.
- **A killed worker is retried.** When the Implementer's process was killed mid-task, Paperclip marked the run failed and retried it about 40 seconds later. The retry picked up the half-written file and finished the job.

## 5. Approving: what the human checks

The approval is a decision, not a click. In this run the operator role was played by the build session through the operator account (no person reviewed these changes); it:

1. read the diff;
2. ran the tests on a fresh checkout;
3. reproduced the original failure on the old release and confirmed it was gone with the fix;
4. wrote what it inspected in the same request that approved:
   `PATCH /api/issues/<id> {"status":"done","comment":"Operator decision: approve ... What I inspected: ..."}`

A comment posted separately does not count as the decision.

## 6. Releasing

Paperclip's job ends at "done". Then (in this run, every step below was done by the build session):

1. move the commits out of the agents' box into a pull request (here: a git bundle, by the operator);
2. tests run on the pull request; merge;
3. staging deploys by itself and runs a smoke test;
4. production waits for an approval of that exact run, and the run is pinned to one commit. Give each environment its own narrowly scoped deploy credential: here staging held the same account-wide token without a reviewer, so the gate held the production job, not the only key;
5. after release, run the check that proves the fix (here, `node scripts/race.mjs <production api> 5`).

## 7. Rolling back

Run the release workflow by hand with the previous commit. It goes through the same approval. Two lessons from the drill:

- **Rollback covers code, not data.** It is safe here because the fix changed no schema. Bookings taken while the old code is back are not rechecked by the fix when you roll forward.
- **Do not roll back your tooling with your app.** The first rollback failed because the old commit carried an old smoke-test bug. The workflow now deploys the app from the release commit and runs its scripts from its own commit.

## 8. What was not Paperclip

Paperclip handled ownership, assignment, execution state, the review stage and the approval stage. The rest was built beside it: correctness in the code, the release gate, smoke tests, the rollback, moving commits out of the container, and this export of the record (`scripts/export_record.py`; Paperclip's own company export leaves out approvals, costs and the activity log).

## 9. Limits seen in this version

- Handoffs between agents can be skipped silently (2 of 2 in this run); someone has to watch the wake-up list.
- An agent's run is cancelled when the ticket moves on, so the run list shows "cancelled" for runs that actually finished their work. Read the comment, not just the run status.
- The cost figures Paperclip shows are its own estimates, not the provider's bill.
- A ticket lock is not a booking lock: Paperclip stops two agents taking the same ticket, not two customers taking the same session. That has to be in your code.
