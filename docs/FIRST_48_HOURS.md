# The first 48 hours on an existing Paperclip setup

This is a plan for joining a team that already runs agents through Paperclip and wants a product launched. It is written without access to any real instance, so it promises a verified diagnosis and hands-on progress, not a production release.

The rule for the whole period: keep what works working. No upgrades, no reorganising agents, no new tools until the current state is written down.

## Hours 0 to 6: agree and inventory

- Agree what "launched" means for the product, in one paragraph: who can book, what they pay, what happens after they book.
- Agree who can make a release decision, and who must be asked before anything touches production.
- List what must not be disturbed: live customer flows, payment settings, anything an agent is in the middle of.
- Inventory, read-only:
  - the Paperclip version and adapter settings of each agent (engine, permissions, working directory, credentials it can reach);
  - open issues by status, owner and age; anything assigned to an agent with no run in the last day;
  - skipped or failed wake-ups and runs (the run list and the wake-up requests, not only the board);
  - repositories, branches and the actual deployment path (who or what can deploy, with which credentials);
  - where review and approval happen today, and whether they are enforced or a habit.

Output: a one-page map of the current flow, with every place a person had to step in marked on it.

## Hours 6 to 24: trace the real journey and rank the blockers

- In an approved test environment, walk the product journey end to end (for a booking product: search, pick a time, book, pay, get the session link, cancel). Note each failure with a reproduction.
- For each blocker, write: the evidence, the owner, the smallest change that removes it, how it will be retested, and how it will be undone if it goes wrong.
- Rank them. The top of the list is what blocks launch and can be fixed safely, not what is most interesting.

Output: a short ranked list, each line reproducible by someone else.

## Hours 24 to 48: take one blocker through the existing path

- Take the highest-ranked blocker that can be done safely and send it through the team's existing Paperclip flow, adding only the controls it is missing (a written acceptance test, a review stage, a human approval, a separate release gate).
- Keep the baseline behaviour: run the existing tests before and after.
- Show the handoff working: a teammate can see from the issue alone what was done, what was decided, and what happens next.
- If a safe release is blocked (access, data, a decision), stop and hand over the reproducible blocker and the decision that is needed, instead of forcing it.

Output: one blocker removed or precisely stuck, the flow map updated, and a list of the next three.
