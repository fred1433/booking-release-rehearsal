// Paris leaves summer time on Sunday 25 October 2026 (CEST, UTC+2 -> CET, UTC+1).
// Sydney stays on summer time (UTC+11), so the gap between teacher and learner
// grows from 9 to 10 hours. These tests pin the whole slot list of the learner-local
// day on each side of the change, so a regression in either direction is visible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBooking, listSlots } from '../src/booking.js';
import { offsetMinutes } from '../src/time.js';
import { fresh, req, NOW, SANDBOX } from './helpers.js';

const DURATION = 45;

// [start instant, Sydney wall clock, Paris wall clock] of every slot of the day.
const slotRows = (slots) => slots.map((s) => [s.start, s.learner, s.teacher]);

test('45-minute slots on Saturday 24 October 2026 (Sydney), Paris still on summer time', async () => {
  const db = fresh();
  const slots = await listSlots(db, { sandbox: SANDBOX, date: '2026-10-24', durationMin: DURATION, now: NOW });

  assert.deepEqual(slotRows(slots), [
    ['2026-10-24T05:00:00.000Z', 'Sat, 24 Oct, 16:00', 'Sat, 24 Oct, 07:00'],
    ['2026-10-24T05:30:00.000Z', 'Sat, 24 Oct, 16:30', 'Sat, 24 Oct, 07:30'],
    ['2026-10-24T06:00:00.000Z', 'Sat, 24 Oct, 17:00', 'Sat, 24 Oct, 08:00'],
    ['2026-10-24T06:30:00.000Z', 'Sat, 24 Oct, 17:30', 'Sat, 24 Oct, 08:30'],
    ['2026-10-24T07:00:00.000Z', 'Sat, 24 Oct, 18:00', 'Sat, 24 Oct, 09:00'],
    ['2026-10-24T07:30:00.000Z', 'Sat, 24 Oct, 18:30', 'Sat, 24 Oct, 09:30'],
    ['2026-10-24T08:00:00.000Z', 'Sat, 24 Oct, 19:00', 'Sat, 24 Oct, 10:00'],
  ]);
  // The teacher's own day is untouched by the learner's time zone: 07:00 to 10:00 Paris,
  // and the last session ends exactly at the 11:00 window edge.
  assert.equal(offsetMinutes(Date.parse('2026-10-24T05:00:00Z'), 'Europe/Paris'), 120);
  assert.equal(offsetMinutes(Date.parse('2026-10-24T05:00:00Z'), 'Australia/Sydney'), 660);
  assert.deepEqual(slots.map((s) => s.free), Array(7).fill(true));
});

test('45-minute slots on Monday 26 October 2026 (Sydney), Paris back on winter time', async () => {
  const db = fresh();
  const slots = await listSlots(db, { sandbox: SANDBOX, date: '2026-10-26', durationMin: DURATION, now: NOW });

  assert.deepEqual(slotRows(slots), [
    ['2026-10-26T06:00:00.000Z', 'Mon, 26 Oct, 17:00', 'Mon, 26 Oct, 07:00'],
    ['2026-10-26T06:30:00.000Z', 'Mon, 26 Oct, 17:30', 'Mon, 26 Oct, 07:30'],
    ['2026-10-26T07:00:00.000Z', 'Mon, 26 Oct, 18:00', 'Mon, 26 Oct, 08:00'],
    ['2026-10-26T07:30:00.000Z', 'Mon, 26 Oct, 18:30', 'Mon, 26 Oct, 08:30'],
    ['2026-10-26T08:00:00.000Z', 'Mon, 26 Oct, 19:00', 'Mon, 26 Oct, 09:00'],
    ['2026-10-26T08:30:00.000Z', 'Mon, 26 Oct, 19:30', 'Mon, 26 Oct, 09:30'],
    ['2026-10-26T09:00:00.000Z', 'Mon, 26 Oct, 20:00', 'Mon, 26 Oct, 10:00'],
  ]);
  assert.equal(offsetMinutes(Date.parse('2026-10-26T06:00:00Z'), 'Europe/Paris'), 60);
  assert.equal(offsetMinutes(Date.parse('2026-10-26T06:00:00Z'), 'Australia/Sydney'), 660);
  assert.deepEqual(slots.map((s) => s.free), Array(7).fill(true));
});

test('the Paris day keeps its shape across the change while every Sydney slot moves one hour later', async () => {
  const db = fresh();
  const before = await listSlots(db, { sandbox: SANDBOX, date: '2026-10-24', durationMin: DURATION, now: NOW });
  const after = await listSlots(db, { sandbox: SANDBOX, date: '2026-10-26', durationMin: DURATION, now: NOW });

  assert.equal(before.length, after.length);
  const parisTime = (s) => s.teacher.slice(-5);
  assert.deepEqual(before.map(parisTime), after.map(parisTime));
  // Same Paris wall clock, one hour later in Sydney, so one hour later in UTC too.
  for (const [i, b] of before.entries()) {
    assert.equal(Date.parse(after[i].start) - Date.parse(b.start), 2 * 86400000 + 3600000);
    assert.equal((Number(b.learner.slice(-5).slice(0, 2)) + 1) % 24, Number(after[i].learner.slice(-5).slice(0, 2)));
  }
});

test('booking the first slot of Monday 26 October stores the post-change UTC instant', async () => {
  const db = fresh();
  const [first] = await listSlots(db, { sandbox: SANDBOX, date: '2026-10-26', durationMin: DURATION, now: NOW });
  assert.equal(first.start, '2026-10-26T06:00:00.000Z'); // 07:00 Paris (UTC+1), not 05:00Z as it would be on summer time

  const r = await createBooking(db, req(first.start, DURATION), { now: NOW });
  assert.equal(r.status, 201);
  assert.equal(r.booking.start, '2026-10-26T06:00:00.000Z');
  assert.equal(r.booking.end, '2026-10-26T06:45:00.000Z');
  assert.equal(r.booking.teacher.local, 'Mon, 26 Oct, 07:00');
  assert.equal(r.booking.learner.local, 'Mon, 26 Oct, 17:00');

  // The stored row holds the instant itself, not a wall-clock time.
  const row = await db.prepare('SELECT start_utc, end_utc FROM bookings WHERE id = ?').bind(r.booking.id).first();
  assert.equal(row.start_utc, Date.parse('2026-10-26T06:00:00Z'));
  assert.equal(row.end_utc, Date.parse('2026-10-26T06:45:00Z'));

  // And the slot list for that day now reports it as taken. The starts are 30 minutes apart
  // but the session runs 45, so it also covers the 07:30 Paris start: both are taken.
  const slots = await listSlots(db, { sandbox: SANDBOX, date: '2026-10-26', durationMin: DURATION, now: NOW });
  assert.deepEqual(slots.map((s) => [s.teacher.slice(-5), s.free, s.reason]), [
    ['07:00', false, 'taken'],
    ['07:30', false, 'taken'],
    ['08:00', true, null],
    ['08:30', true, null],
    ['09:00', true, null],
    ['09:30', true, null],
    ['10:00', true, null],
  ]);
});
