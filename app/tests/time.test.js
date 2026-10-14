import test from 'node:test';
import assert from 'node:assert/strict';
import { localToInstant, candidateInstants, offsetMinutes, label, LocalTimeError } from '../src/time.js';
import { listSlots } from '../src/booking.js';
import { fresh, NOW, SANDBOX } from './helpers.js';

const iso = (ms) => new Date(ms).toISOString();

test('the same instant reads correctly in Paris and Sydney', () => {
  const t = Date.parse('2026-10-20T06:00:00Z');
  assert.match(label(t, 'Europe/Paris'), /20 Oct.*08:00/);
  assert.match(label(t, 'Australia/Sydney'), /20 Oct.*17:00/);
});

test('Paris falls back on 25 Oct 2026: 02:30 happens twice, the earlier one is used', () => {
  const wall = { y: 2026, m: 10, d: 25, hh: 2, mm: 30 };
  assert.deepEqual(candidateInstants(wall, 'Europe/Paris').map(iso), ['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']);
  assert.equal(iso(localToInstant(wall, 'Europe/Paris')), '2026-10-25T00:30:00.000Z');
  assert.throws(() => localToInstant(wall, 'Europe/Paris', { ambiguous: 'reject' }), (e) => e instanceof LocalTimeError && e.kind === 'ambiguous');
});

test('Paris springs forward on 28 Mar 2027: 02:30 does not exist and is rejected', () => {
  assert.throws(() => localToInstant({ y: 2027, m: 3, d: 28, hh: 2, mm: 30 }, 'Europe/Paris'), (e) => e.kind === 'nonexistent');
});

test('Sydney springs forward on 4 Oct 2026 and falls back on 4 Apr 2027', () => {
  assert.throws(() => localToInstant({ y: 2026, m: 10, d: 4, hh: 2, mm: 30 }, 'Australia/Sydney'), (e) => e.kind === 'nonexistent');
  assert.equal(candidateInstants({ y: 2027, m: 4, d: 4, hh: 2, mm: 30 }, 'Australia/Sydney').length, 2);
  assert.equal(offsetMinutes(Date.parse('2026-10-03T12:00:00Z'), 'Australia/Sydney'), 600);
  assert.equal(offsetMinutes(Date.parse('2026-10-04T12:00:00Z'), 'Australia/Sydney'), 660);
});

test('the gap between teacher and learner changes when Paris leaves summer time', async () => {
  const db = fresh();
  const before = await listSlots(db, { sandbox: SANDBOX, date: '2026-10-23', durationMin: 30, now: NOW });
  const after = await listSlots(db, { sandbox: SANDBOX, date: '2026-10-26', durationMin: 30, now: NOW });
  const first = (s) => [s[0].teacher.slice(-5), s[0].learner.slice(-5)];
  assert.deepEqual(first(before), ['07:00', '16:00']); // Paris UTC+2, Sydney UTC+11
  assert.deepEqual(first(after), ['07:00', '17:00']);  // Paris UTC+1, Sydney UTC+11
});

test('a session ending exactly at the window edge is allowed, one running past it is not', async () => {
  const db = fresh();
  const s = await listSlots(db, { sandbox: SANDBOX, date: '2026-10-20', durationMin: 60, now: NOW });
  assert.equal(s.at(-1).teacher.slice(-5), '10:00');
});
