// Handoff reconciler for Paperclip 2026.1012.0, run beside Paperclip (not inside it).
//
// Problem it answers, seen twice in this rehearsal: when an implementer finishes, Paperclip routes
// the issue to review and tries to wake the reviewer, but the wake-up can be skipped because the
// previous run has not yet released its workspace lease (81 ms and 43 ms races). Nothing retries it,
// so the issue reads "in review" while nobody works on it.
//
// What it does, per issue in review with an agent as the current reviewer:
//   1. leave it alone while any run on the issue is active or any of its leases is still held;
//   2. leave it alone if the reviewer already has a run that started after the handoff;
//   3. otherwise, once the last run finished at least GRACE ago, wake the reviewer ONCE
//      (one attempt per review round, remembered in a state file) and say so on the issue;
//   4. if no reviewer run appears within VERIFY after that, open one blocker issue for the
//      accountable person, with the single action needed, and stop.
//
// Usage: node scripts/handoff-reconciler.mjs <paperclip-url> <cookie-file> <company-id> <state.json> [--once] [--log file]

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';

const ACTIVE = new Set(['queued', 'running', 'scheduled_retry']);
export const DEFAULTS = { graceMs: 10_000, verifyMs: 180_000 };

const t = (x) => (x ? Date.parse(x) : 0);

export async function reconcileOnce(api, state, now = Date.now(), opts = DEFAULTS) {
  const actions = [];
  const log = (issue, action, detail = {}) => actions.push({ at: new Date(now).toISOString(), issue: issue.identifier, action, ...detail });
  const issues = (await api.listIssues()).filter((i) => i.status === 'in_review');
  if (!issues.length) return actions;
  const runs = await api.listRuns();
  const leases = await api.listLeases();
  for (const summary of issues) {
    const issue = await api.getIssue(summary.id);
    const es = issue.executionState;
    if (!es || es.status !== 'pending' || es.currentParticipant?.type !== 'agent') continue;
    const reviewer = es.currentParticipant.agentId;
    const key = `${issue.id}:${es.currentStageId}:${es.lastDecisionId ?? 'none'}:${es.changesRequestedCount ?? 0}`;
    const mine = runs.filter((r) => r.issueId === issue.id);
    if (mine.some((r) => ACTIVE.has(r.status))) { log(issue, 'skip_active_run'); continue; }
    if (leases.some((l) => l.issueId === issue.id && !l.releasedAt)) { log(issue, 'skip_lease_held'); continue; }
    const handoffAt = Math.max(0, ...mine.filter((r) => r.agentId !== reviewer).map((r) => t(r.finishedAt)));
    const lastFinished = Math.max(0, ...mine.map((r) => t(r.finishedAt)));
    const reviewerStarted = mine.some((r) => r.agentId === reviewer && t(r.createdAt) > handoffAt);
    const entry = state[key] ?? {};
    if (reviewerStarted) {
      if (entry.wokeAt && !entry.recovered) { entry.recovered = new Date(now).toISOString(); state[key] = entry; log(issue, 'recovered', { reviewer }); }
      continue;
    }
    if (now - lastFinished < opts.graceMs) { log(issue, 'skip_grace'); continue; }
    if (!entry.wokeAt) {
      const run = await api.wake(reviewer, issue.id, `handoff-reconcile:${key}`);
      entry.wokeAt = new Date(now).toISOString(); entry.wakeRunId = run?.id ?? null; state[key] = entry;
      await api.comment(issue.id, `Handoff reconciler: the review stage is pending for this agent, but no review run started after the handoff (last run finished ${new Date(lastFinished).toISOString()}, no active run, no held lease). Woke the reviewer once. If no review run starts within ${Math.round(opts.verifyMs / 60000)} minutes, a blocker issue will be opened for the accountable person.`);
      log(issue, 'woke_reviewer_once', { reviewer, wakeRunId: entry.wakeRunId });
      continue;
    }
    if (!entry.blockerId && now - t(entry.wokeAt) >= opts.verifyMs) {
      const blocker = await api.createBlocker(issue, reviewer);
      entry.blockerId = blocker?.id ?? 'created'; state[key] = entry;
      await api.comment(issue.id, `Handoff reconciler: the single retry did not start a review run. Opened blocker ${blocker?.identifier ?? ''} for the accountable person. No further automatic wake-ups for this round.`);
      log(issue, 'opened_blocker', { blocker: blocker?.identifier });
    }
  }
  return actions;
}

export function httpApi(base, cookie, companyId) {
  const h = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' };
  const get = async (p) => (await fetch(base + '/api' + p, { headers: h })).json();
  const post = async (p, body, method = 'POST') => (await fetch(base + '/api' + p, { method, headers: h, body: JSON.stringify(body) })).json();
  let envIds = null;
  return {
    listIssues: () => get(`/companies/${companyId}/issues`),
    getIssue: (id) => get(`/issues/${id}`),
    listRuns: async () => (await get(`/companies/${companyId}/heartbeat-runs`)).map((r) => ({ ...r, issueId: r.contextSnapshot?.issueId ?? null })),
    listLeases: async () => {
      envIds ??= (await get(`/companies/${companyId}/environments`)).map((e) => e.id);
      return (await Promise.all(envIds.map((id) => get(`/environments/${id}/leases`)))).flat();
    },
    wake: (agentId, issueId, idempotencyKey) => post(`/agents/${agentId}/wakeup`, { source: 'assignment', triggerDetail: 'system', reason: 'execution_review_requested', idempotencyKey, payload: { issueId } }),
    comment: (issueId, body) => post(`/issues/${issueId}/comments`, { body }),
    createBlocker: (issue, reviewer) => post(`/companies/${companyId}/issues`, {
      title: `Review of ${issue.identifier} did not start`,
      description: `The review stage of ${issue.identifier} is waiting for agent ${reviewer}, but no review run started, and one automatic retry did not help.\n\nAction needed: open ${issue.identifier}, check the agent's last runs and wake-up requests, then either wake the reviewer or reassign the review.`,
      status: 'todo', priority: 'high', assigneeUserId: issue.responsibleUserId ?? issue.createdByUserId,
    }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [base, cookieFile, companyId, stateFile, ...rest] = process.argv.slice(2);
  const once = rest.includes('--once');
  const logFile = rest.includes('--log') ? rest[rest.indexOf('--log') + 1] : null;
  const api = httpApi(base, readFileSync(cookieFile, 'utf8').trim(), companyId);
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
  const last = new Map();
  do {
    const actions = await reconcileOnce(api, state);
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
    for (const a of actions.filter((a) => a.action !== 'skip_grace')) {
      if (last.get(a.issue) === a.action) continue; // log changes only
      last.set(a.issue, a.action);
      const line = JSON.stringify(a);
      console.log(line);
      if (logFile) appendFileSync(logFile, line + '\n');
    }
    if (!once) await new Promise((r) => setTimeout(r, 3000));
  } while (!once);
}
