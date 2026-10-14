// Requirement for ticket "overlapping bookings": written before any fix, and expected to fail on main.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBooking, cancelBooking, listBookings, BookingError } from '../src/booking.js';
import { fresh, req, NOW, SANDBOX, TUE_0800, at } from './helpers.js';

const opts = { now: NOW };
const confirmed = async (db) => (await listBookings(db, SANDBOX)).filter((b) => b.status === 'confirmed');
const overlaps = (a, b) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
const noOverlap = (list) => list.every((a, i) => list.every((b, j) => i === j || !overlaps(a, b)));

test('a 30-minute session cannot start inside a confirmed 60-minute session', async () => {
  const db = fresh();
  await createBooking(db, req(TUE_0800, 60), opts);
  await assert.rejects(createBooking(db, req(at(TUE_0800, 30), 30), opts), (e) => e instanceof BookingError && e.status === 409);
});

test('a 60-minute session cannot swallow a confirmed 30-minute session', async () => {
  const db = fresh();
  await createBooking(db, req(at(TUE_0800, 30), 30), opts);
  await assert.rejects(createBooking(db, req(TUE_0800, 60), opts), (e) => e instanceof BookingError && e.status === 409);
});

test('two 45-minute sessions sharing 15 minutes conflict', async () => {
  const db = fresh();
  await createBooking(db, req(TUE_0800, 45), opts);
  await assert.rejects(createBooking(db, req(at(TUE_0800, 30), 45), opts), (e) => e instanceof BookingError && e.status === 409);
});

test('concurrent overlapping requests with different durations confirm at most one', async () => {
  const db = fresh();
  const results = await Promise.allSettled([
    createBooking(db, req(TUE_0800, 60), opts),
    createBooking(db, req(at(TUE_0800, 30), 30), opts),
    createBooking(db, req(at(TUE_0800, 15), 45), opts),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  assert.equal(ok.length, 1, 'exactly one request should win');
  for (const r of results.filter((r) => r.status === 'rejected')) assert.equal(r.reason.status, 409);
  const list = await confirmed(db);
  assert.equal(list.length, 1);
  assert.ok(noOverlap(list));
});

test('concurrent requests for the same start confirm one', async () => {
  const db = fresh();
  const results = await Promise.allSettled([createBooking(db, req(TUE_0800, 30), opts), createBooking(db, req(TUE_0800, 30), opts)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await confirmed(db)).length, 1);
});

test('a cancelled session does not block an overlapping one', async () => {
  const db = fresh();
  const r = await createBooking(db, req(TUE_0800, 60), opts);
  await cancelBooking(db, { sandbox: SANDBOX, id: r.booking.id }, opts);
  assert.equal((await createBooking(db, req(at(TUE_0800, 30), 30), opts)).status, 201);
});
