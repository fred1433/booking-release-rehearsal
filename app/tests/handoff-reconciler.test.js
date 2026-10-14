import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileOnce } from '../../scripts/handoff-reconciler.mjs';

const IMPL = 'impl', REV = 'rev';
const T0 = Date.parse('2026-10-14T15:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

function fakeApi({ runs = [], leases = [], status = 'in_review' } = {}) {
  const calls = { wake: [], comment: [], blocker: [] };
  const issue = { id: 'i1', identifier: 'BOO-9', status, responsibleUserId: 'op',
    executionState: { status: 'pending', currentStageId: 's1', lastDecisionId: null, currentParticipant: { type: 'agent', agentId: REV } } };
  return {
    calls, runs, leases,
    listIssues: async () => [issue],
    getIssue: async () => issue,
    listRuns: async () => runs,
    listLeases: async () => leases,
    wake: async (agentId, issueId, key) => { calls.wake.push({ agentId, issueId, key }); return { id: 'r-woken' }; },
    comment: async (id, body) => { calls.comment.push(body); },
    createBlocker: async () => { calls.blocker.push(1); return { id: 'b1', identifier: 'BOO-10' }; },
  };
}
const implDone = { id: 'r1', agentId: IMPL, issueId: 'i1', status: 'cancelled', createdAt: iso(T0 - 120000), finishedAt: iso(T0) };

test('a skipped review wake-up is retried exactly once', async () => {
  const api = fakeApi({ runs: [implDone], leases: [{ issueId: 'i1', releasedAt: iso(T0 + 80) }] });
  const state = {};
  await reconcileOnce(api, state, T0 + 15000);
  await reconcileOnce(api, state, T0 + 20000);
  await reconcileOnce(api, state, T0 + 25000);
  assert.equal(api.calls.wake.length, 1);
  assert.equal(api.calls.wake[0].agentId, REV);
  assert.equal(api.calls.comment.length, 1);
});

test('nothing happens while a run on the issue is active', async () => {
  const api = fakeApi({ runs: [implDone, { id: 'r2', agentId: IMPL, issueId: 'i1', status: 'running', createdAt: iso(T0 + 1000) }] });
  const out = await reconcileOnce(api, {}, T0 + 60000);
  assert.equal(api.calls.wake.length, 0);
  assert.equal(out[0].action, 'skip_active_run');
});

test('nothing happens while a lease on the issue is still held', async () => {
  const api = fakeApi({ runs: [implDone], leases: [{ issueId: 'i1', releasedAt: null }] });
  const out = await reconcileOnce(api, {}, T0 + 60000);
  assert.equal(api.calls.wake.length, 0);
  assert.equal(out[0].action, 'skip_lease_held');
});

test('no wake-up inside the grace period after the handoff', async () => {
  const api = fakeApi({ runs: [implDone] });
  await reconcileOnce(api, {}, T0 + 2000);
  assert.equal(api.calls.wake.length, 0);
});

test('no second reviewer when the reviewer already started', async () => {
  const api = fakeApi({ runs: [implDone, { id: 'r3', agentId: REV, issueId: 'i1', status: 'succeeded', createdAt: iso(T0 + 500), finishedAt: iso(T0 + 9000) }] });
  await reconcileOnce(api, {}, T0 + 60000);
  assert.equal(api.calls.wake.length, 0);
});

test('if the retry starts nothing, one blocker is opened, then it stops', async () => {
  const api = fakeApi({ runs: [implDone] });
  const state = {};
  await reconcileOnce(api, state, T0 + 15000);            // wake once
  await reconcileOnce(api, state, T0 + 15000 + 200000);   // past verify window, still no reviewer run
  await reconcileOnce(api, state, T0 + 15000 + 400000);
  assert.equal(api.calls.wake.length, 1);
  assert.equal(api.calls.blocker.length, 1);
});

test('a new review round after changes requested gets its own single retry', async () => {
  const api = fakeApi({ runs: [implDone] });
  const state = {};
  await reconcileOnce(api, state, T0 + 15000);
  (await api.getIssue()).executionState.lastDecisionId = 'd2';
  await reconcileOnce(api, state, T0 + 30000);
  assert.equal(api.calls.wake.length, 2);
});
