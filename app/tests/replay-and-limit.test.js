// Requirement for ticket BOO-3, written before any fix. Sequences found by an external review of the demo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBooking, cancelBooking, listBookings, BookingError, MAX_BOOKINGS_PER_SANDBOX } from '../src/booking.js';
import { localToInstant } from '../src/time.js';
import { fresh, req, SANDBOX, TUE_0800, NOW } from './helpers.js';

const START = Date.parse(TUE_0800);

test('a retry after the one-hour cutoff returns the original booking', async () => {
  const db = fresh();
  const body = req(TUE_0800, 30);
  const first = await createBooking(db, body, { now: START - 61 * 60000 });
  const retry = await createBooking(db, { ...body }, { now: START - 59 * 60000 });
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.booking.id, first.booking.id);
  assert.equal((await listBookings(db, SANDBOX)).length, 1);
});

test('a retry after cancellation returns the cancelled booking and does not resurrect it', async () => {
  const db = fresh();
  const body = req(TUE_0800, 30);
  const first = await createBooking(db, body, { now: NOW });
  await cancelBooking(db, { sandbox: SANDBOX, id: first.booking.id }, { now: NOW });
  const retry = await createBooking(db, { ...body }, { now: NOW });
  assert.equal(retry.status, 200);
  assert.equal(retry.booking.id, first.booking.id);
  assert.equal(retry.booking.status, 'cancelled');
  const all = await listBookings(db, SANDBOX);
  assert.equal(all.filter((b) => b.status === 'confirmed').length, 0);
});

test('a key reused for a different request is still refused after the cutoff', async () => {
  const db = fresh();
  const body = req(TUE_0800, 30);
  await createBooking(db, body, { now: START - 61 * 60000 });
  await assert.rejects(createBooking(db, { ...body, durationMin: 60 }, { now: START - 59 * 60000 }),
    (e) => e instanceof BookingError && e.status === 422 && e.code === 'idempotency_key_reused');
});

test('the per-sandbox limit holds under concurrent requests', async () => {
  const db = fresh();
  const starts = [];
  for (const d of [20, 21, 22, 23, 24, 26]) {
    for (let t = 7 * 60; t + 30 <= 11 * 60; t += 30) {
      starts.push(new Date(localToInstant({ y: 2026, m: 10, d, hh: Math.floor(t / 60), mm: t % 60 }, 'Europe/Paris')).toISOString());
    }
  }
  const limit = MAX_BOOKINGS_PER_SANDBOX;
  for (let i = 0; i < limit - 1; i++) assert.equal((await createBooking(db, req(starts[i], 30), { now: NOW })).status, 201);
  const results = await Promise.allSettled(starts.slice(limit - 1, limit + 2).map((s) => createBooking(db, req(s, 30), { now: NOW })));
  const confirmed = (await listBookings(db, SANDBOX)).filter((b) => b.status === 'confirmed').length;
  assert.equal(confirmed, limit, `expected exactly ${limit} confirmed bookings, got ${confirmed}`);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const r of results.filter((r) => r.status === 'rejected')) assert.equal(r.reason.status, 429);
});
