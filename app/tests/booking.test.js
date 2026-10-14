import test from 'node:test';
import assert from 'node:assert/strict';
import { createBooking, cancelBooking, listBookings, listSlots, BookingError } from '../src/booking.js';
import { fresh, req, NOW, SANDBOX, TUE_0800, at, key } from './helpers.js';

const opts = { now: NOW };
const rejects = async (p, status, code) => {
  await assert.rejects(p, (e) => e instanceof BookingError && e.status === status && (!code || e.code === code));
};

test('books a 45-minute session and returns both local times', async () => {
  const db = fresh();
  const r = await createBooking(db, req(TUE_0800, 45), opts);
  assert.equal(r.status, 201);
  assert.equal(r.booking.status, 'confirmed');
  assert.equal(r.booking.end, '2026-10-20T06:45:00.000Z');
  assert.match(r.booking.teacher.local, /08:00/);
  assert.match(r.booking.learner.local, /17:00/);
  assert.deepEqual(r.booking.price, { amountCents: 6000, currency: 'AUD', simulated: true });
});

test('rejects the exact same slot twice', async () => {
  const db = fresh();
  await createBooking(db, req(TUE_0800, 60), opts);
  await rejects(createBooking(db, req(TUE_0800, 60), opts), 409, 'slot_taken');
});

test('adjacent sessions do not conflict (end is exclusive)', async () => {
  const db = fresh();
  assert.equal((await createBooking(db, req(TUE_0800, 60), opts)).status, 201);
  assert.equal((await createBooking(db, req(at(TUE_0800, 60), 30), opts)).status, 201);
  assert.equal((await createBooking(db, req(at(TUE_0800, -30), 30), opts)).status, 201);
});

test('a retry after a lost response returns the original booking, not a second one', async () => {
  const db = fresh();
  const body = req(TUE_0800, 30);
  const first = await createBooking(db, body, opts); // imagine this response never reached the browser
  const retry = await createBooking(db, { ...body }, opts);
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.replayed, true);
  assert.equal(retry.booking.id, first.booking.id);
  assert.equal((await listBookings(db, SANDBOX)).length, 1);
});

test('two simultaneous retries with the same key create one booking', async () => {
  const db = fresh();
  const body = req(TUE_0800, 30);
  const [a, b] = await Promise.all([createBooking(db, body, opts), createBooking(db, { ...body }, opts)]);
  assert.equal(a.booking.id, b.booking.id);
  assert.equal((await listBookings(db, SANDBOX)).length, 1);
});

test('reusing a key for a different booking is refused', async () => {
  const db = fresh();
  const body = req(TUE_0800, 30);
  await createBooking(db, body, opts);
  await rejects(createBooking(db, { ...body, start: at(TUE_0800, 60) }, opts), 422, 'idempotency_key_reused');
});

test('cancellation frees the slot and is idempotent', async () => {
  const db = fresh();
  const r = await createBooking(db, req(TUE_0800, 60), opts);
  const c1 = await cancelBooking(db, { sandbox: SANDBOX, id: r.booking.id }, opts);
  const c2 = await cancelBooking(db, { sandbox: SANDBOX, id: r.booking.id }, opts);
  assert.equal(c1.booking.status, 'cancelled');
  assert.equal(c2.alreadyCancelled, true);
  assert.equal((await createBooking(db, req(TUE_0800, 60), opts)).status, 201);
  const all = await listBookings(db, SANDBOX);
  assert.deepEqual(all.map((b) => b.status).sort(), ['cancelled', 'confirmed']);
});

test('visitors are isolated from each other', async () => {
  const db = fresh();
  const r = await createBooking(db, req(TUE_0800, 60), opts);
  assert.equal((await createBooking(db, req(TUE_0800, 60, { sandbox: 'other-visitor' }), opts)).status, 201);
  await rejects(cancelBooking(db, { sandbox: 'other-visitor', id: r.booking.id }, opts), 404);
});

test('refuses sessions outside availability, too soon or with a bad duration', async () => {
  const db = fresh();
  await rejects(createBooking(db, req('2026-10-20T08:45:00.000Z', 30), opts), 422, 'outside_availability'); // 10:45-11:15 Paris
  await rejects(createBooking(db, req('2026-10-25T06:00:00.000Z', 30), opts), 422, 'outside_availability'); // Sunday
  await rejects(createBooking(db, req('2026-10-19T00:30:00.000Z', 30), opts), 422);
  await rejects(createBooking(db, req(TUE_0800, 50), opts), 400, 'bad_duration');
  await rejects(createBooking(db, req(at(TUE_0800, 5), 30), opts), 400, 'bad_start');
});

test('slot list marks overlapping starts as taken for every duration', async () => {
  const db = fresh();
  await createBooking(db, req(TUE_0800, 60), opts); // 08:00-09:00 Paris
  const slots = await listSlots(db, { sandbox: SANDBOX, date: '2026-10-20', durationMin: 30, now: NOW });
  const byTeacher = Object.fromEntries(slots.map((s) => [s.teacher.slice(-5), s.free]));
  assert.equal(byTeacher['07:30'], true);
  assert.equal(byTeacher['08:00'], false);
  assert.equal(byTeacher['08:30'], false);
  assert.equal(byTeacher['09:00'], true);
});
