import { localParts, localToInstant, localDateString, label, addDays, weekday, LocalTimeError } from './time.js';

export const DURATIONS = [30, 45, 60];
export const TEACHER = {
  id: 'teacher-synthetic-1',
  name: 'Synthetic teacher',
  tz: 'Europe/Paris',
  // Weekly availability in the teacher's own wall-clock time. Monday to Saturday.
  windows: [{ from: '07:00', to: '11:00' }],
  days: [1, 2, 3, 4, 5, 6],
  currency: 'AUD',
  prices: { 30: 4500, 45: 6000, 60: 7500 },
};
export const LEARNER_TZ = 'Australia/Sydney';
export const MIN_LEAD_MS = 60 * 60 * 1000;
export const MAX_AHEAD_DAYS = 28;
export const MAX_BOOKINGS_PER_SANDBOX = 40;
const STEP_MIN = 15;

export class BookingError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

function checkTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; }
  catch { throw new BookingError(400, 'bad_timezone', 'unknown time zone'); }
}

export function validSandbox(s) { return typeof s === 'string' && /^[a-z0-9-]{8,40}$/.test(s); }

/** Is [start, start+duration) inside one availability window of the teacher (teacher wall clock)? */
export function withinAvailability(startMs, durationMin, teacher = TEACHER) {
  const p = localParts(startMs, teacher.tz);
  const dateStr = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  if (!teacher.days.includes(weekday(dateStr))) return false;
  const endMs = startMs + durationMin * 60000;
  return teacher.windows.some((w) => {
    const [fh, fm] = w.from.split(':').map(Number);
    const [th, tm] = w.to.split(':').map(Number);
    let from, to;
    try {
      from = localToInstant({ y: p.y, m: p.m, d: p.d, hh: fh, mm: fm }, teacher.tz);
      to = localToInstant({ y: p.y, m: p.m, d: p.d, hh: th, mm: tm }, teacher.tz);
    } catch (e) { if (e instanceof LocalTimeError) return false; throw e; }
    return startMs >= from && endMs <= to;
  });
}

function validateRequest(req, now) {
  if (!validSandbox(req.sandbox)) throw new BookingError(400, 'bad_sandbox', 'sandbox must be 8-40 chars of a-z, 0-9 or -');
  if (typeof req.idempotencyKey !== 'string' || req.idempotencyKey.length < 8 || req.idempotencyKey.length > 80)
    throw new BookingError(400, 'bad_idempotency_key', 'idempotencyKey is required (8-80 chars)');
  const duration = Number(req.durationMin);
  if (!DURATIONS.includes(duration)) throw new BookingError(400, 'bad_duration', 'durationMin must be 30, 45 or 60');
  // An instant needs its offset: "2026-10-26T08:00Z" or "...+11:00". A bare local time is refused.
  const hasZone = typeof req.start === 'string' && /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(req.start);
  const start = hasZone ? Date.parse(req.start) : NaN;
  if (!Number.isFinite(start)) throw new BookingError(400, 'bad_start', 'start must be an ISO-8601 instant with Z or a UTC offset');
  if (start % (STEP_MIN * 60000) !== 0) throw new BookingError(400, 'bad_start', 'start must be on a 15-minute boundary');
  if (start < now + MIN_LEAD_MS) throw new BookingError(422, 'too_soon', 'start must be at least one hour ahead');
  if (start > now + MAX_AHEAD_DAYS * 86400000) throw new BookingError(422, 'too_far', `start must be within ${MAX_AHEAD_DAYS} days`);
  if (!withinAvailability(start, duration)) throw new BookingError(422, 'outside_availability', 'the teacher is not available for that whole session');
  const learnerTz = checkTz(req.learnerTz || LEARNER_TZ);
  return { sandbox: req.sandbox, key: req.idempotencyKey, duration, start, end: start + duration * 60000, learnerTz };
}

export function present(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    start: new Date(row.start_utc).toISOString(),
    end: new Date(row.end_utc).toISOString(),
    durationMin: row.duration_min,
    teacher: { id: row.teacher_id, tz: row.teacher_tz, local: label(row.start_utc, row.teacher_tz) },
    learner: { tz: row.learner_tz, local: label(row.start_utc, row.learner_tz) },
    price: { amountCents: row.price_cents, currency: row.currency, simulated: true },
    createdAt: new Date(row.created_at).toISOString(),
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    appSha: row.app_sha,
  };
}

function sameRequest(row, v) {
  return row.start_utc === v.start && row.duration_min === v.duration;
}

async function findByKey(db, sandbox, key) {
  return db.prepare('SELECT * FROM bookings WHERE sandbox = ? AND idem_key = ?').bind(sandbox, key).first();
}

/**
 * Insert the booking only if no confirmed session of this teacher in this sandbox
 * overlaps [start, end). Returns the number of rows written: 0 means someone else holds
 * part of that interval.
 *
 * The overlap test lives inside the INSERT on purpose. SQLite, and therefore D1, runs a
 * single statement in its own transaction while holding the write lock, so no other request
 * can slip a row in between the test and the write. A separate SELECT could be overtaken,
 * which is how two sessions of different lengths used to both get confirmed.
 */
async function insertIfFree(db, v, { id, now, appSha }) {
  const res = await db
    .prepare(`INSERT INTO bookings (id, sandbox, teacher_id, start_utc, end_utc, duration_min, teacher_tz, learner_tz,
                price_cents, currency, status, idem_key, created_at, app_sha)
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?
              WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE sandbox = ? AND teacher_id = ?
                AND status = 'confirmed' AND start_utc < ? AND end_utc > ?)`)
    .bind(id, v.sandbox, TEACHER.id, v.start, v.end, v.duration, TEACHER.tz, v.learnerTz,
      TEACHER.prices[v.duration], TEACHER.currency, v.key, now, appSha,
      v.sandbox, TEACHER.id, v.end, v.start)
    .run();
  return res?.meta?.changes ?? 0;
}

/**
 * Create a booking. Returns { status, booking, replayed }.
 * A retry with the same idempotency key returns the original booking (status 200).
 */
export async function createBooking(db, req, { now = Date.now(), appSha = 'dev', newId = () => crypto.randomUUID() } = {}) {
  const v = validateRequest(req, now);

  const prior = await findByKey(db, v.sandbox, v.key);
  if (prior) {
    if (!sameRequest(prior, v)) throw new BookingError(422, 'idempotency_key_reused', 'this idempotency key was used for a different booking');
    return { status: 200, booking: present(prior), replayed: true };
  }

  const count = await db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE sandbox = ? AND status = 'confirmed'").bind(v.sandbox).first();
  if (count && count.n >= MAX_BOOKINGS_PER_SANDBOX) throw new BookingError(429, 'sandbox_full', 'this sandbox already holds 40 bookings; reset it');

  const id = newId();
  let written;
  try {
    written = await insertIfFree(db, v, { id, now, appSha });
  } catch (e) {
    // A concurrent retry with the same key beat us to it, at a start that does not overlap ours.
    if (/UNIQUE constraint failed/i.test(String(e && e.message))) {
      const row = await findByKey(db, v.sandbox, v.key);
      if (row && sameRequest(row, v)) return { status: 200, booking: present(row), replayed: true };
      if (row) throw new BookingError(422, 'idempotency_key_reused', 'this idempotency key was used for a different booking');
    }
    throw e;
  }
  if (written === 0) {
    // The interval is taken. If it is taken by a concurrent retry of this very request,
    // the retry has to see the original booking rather than a conflict.
    const row = await findByKey(db, v.sandbox, v.key);
    if (row && sameRequest(row, v)) return { status: 200, booking: present(row), replayed: true };
    throw new BookingError(409, 'slot_taken', 'the teacher already has a session at that time');
  }
  const row = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
  return { status: 201, booking: present(row), replayed: false };
}

export async function cancelBooking(db, { sandbox, id }, { now = Date.now() } = {}) {
  if (!validSandbox(sandbox)) throw new BookingError(400, 'bad_sandbox', 'bad sandbox');
  const row = await db.prepare('SELECT * FROM bookings WHERE id = ? AND sandbox = ?').bind(id, sandbox).first();
  if (!row) throw new BookingError(404, 'not_found', 'no such booking in this sandbox');
  if (row.status === 'cancelled') return { status: 200, booking: present(row), alreadyCancelled: true };
  await db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND sandbox = ? AND status = 'confirmed'")
    .bind(now, id, sandbox).run();
  const after = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
  return { status: 200, booking: present(after), alreadyCancelled: false };
}

export async function listBookings(db, sandbox) {
  if (!validSandbox(sandbox)) throw new BookingError(400, 'bad_sandbox', 'bad sandbox');
  const { results } = await db.prepare('SELECT * FROM bookings WHERE sandbox = ? ORDER BY start_utc').bind(sandbox).all();
  return results.map(present);
}

/** Bookable starts for one learner-local date, every 30 minutes, with a free/taken flag. */
export async function listSlots(db, { sandbox, date, durationMin, learnerTz = LEARNER_TZ, now = Date.now() }) {
  if (!validSandbox(sandbox)) throw new BookingError(400, 'bad_sandbox', 'bad sandbox');
  const duration = Number(durationMin);
  if (!DURATIONS.includes(duration)) throw new BookingError(400, 'bad_duration', 'durationMin must be 30, 45 or 60');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new BookingError(400, 'bad_date', 'date must be YYYY-MM-DD');
  checkTz(learnerTz);
  const starts = [];
  for (let k = -1; k <= 1; k++) {
    const tDate = addDays(date, k);
    if (!TEACHER.days.includes(weekday(tDate))) continue;
    const [y, m, d] = tDate.split('-').map(Number);
    for (const w of TEACHER.windows) {
      for (let t = hm(w.from); t + duration <= hm(w.to); t += 30) {
        try {
          const inst = localToInstant({ y, m, d, hh: Math.floor(t / 60), mm: t % 60 }, TEACHER.tz, { ambiguous: 'reject' });
          if (localDateString(inst, learnerTz) === date && withinAvailability(inst, duration)) starts.push(inst);
        } catch (e) { if (!(e instanceof LocalTimeError)) throw e; }
      }
    }
  }
  starts.sort((a, b) => a - b);
  const lo = starts[0] ?? 0, hi = (starts.at(-1) ?? 0) + duration * 60000;
  const { results } = await db
    .prepare("SELECT start_utc, end_utc FROM bookings WHERE sandbox = ? AND teacher_id = ? AND status = 'confirmed' AND start_utc < ? AND end_utc > ?")
    .bind(sandbox, TEACHER.id, hi, lo).all();
  return starts.map((s) => {
    const e = s + duration * 60000;
    const taken = results.some((b) => b.start_utc < e && b.end_utc > s);
    const tooSoon = s < now + MIN_LEAD_MS || s > now + MAX_AHEAD_DAYS * 86400000;
    return {
      start: new Date(s).toISOString(),
      learner: label(s, learnerTz), teacher: label(s, TEACHER.tz),
      free: !taken && !tooSoon, reason: taken ? 'taken' : tooSoon ? 'out_of_range' : null,
      price: { amountCents: TEACHER.prices[duration], currency: TEACHER.currency, simulated: true },
    };
  });
}
