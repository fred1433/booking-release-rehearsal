// Time-zone helpers built on Intl only (works in Node and in Cloudflare Workers).
// Policy for local wall-clock times that do not map to exactly one instant:
//   - nonexistent (clock jumps forward): rejected
//   - ambiguous (clock falls back): the earlier instant is used, unless policy says "reject"

const dtfCache = new Map();
function dtf(tz) {
  if (!dtfCache.has(tz)) {
    dtfCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return dtfCache.get(tz);
}

export function localParts(instantMs, tz) {
  const p = {};
  for (const { type, value } of dtf(tz).formatToParts(new Date(instantMs))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second };
}

/** UTC offset of `tz` at `instantMs`, in minutes (Paris summer = 120). */
export function offsetMinutes(instantMs, tz) {
  const p = localParts(instantMs, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60000);
}

/** All instants that show the wall-clock time {y,m,d,hh,mm} in tz (0, 1 or 2 of them). */
export function candidateInstants({ y, m, d, hh, mm }, tz) {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsets = new Set([offsetMinutes(wall - 86400000, tz), offsetMinutes(wall, tz), offsetMinutes(wall + 86400000, tz)]);
  const out = new Set();
  for (const o of offsets) {
    const inst = wall - o * 60000;
    if (offsetMinutes(inst, tz) === o) out.add(inst);
  }
  return [...out].sort((a, b) => a - b);
}

export class LocalTimeError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

/** Convert a wall-clock time to one instant, applying the policy above. */
export function localToInstant(wall, tz, { ambiguous = 'earlier' } = {}) {
  const c = candidateInstants(wall, tz);
  if (c.length === 0) throw new LocalTimeError('nonexistent', `${fmtWall(wall)} does not exist in ${tz} (clock change)`);
  if (c.length > 1 && ambiguous === 'reject') throw new LocalTimeError('ambiguous', `${fmtWall(wall)} happens twice in ${tz}`);
  return c[0];
}

export function fmtWall({ y, m, d, hh, mm }) {
  const z = (n) => String(n).padStart(2, '0');
  return `${y}-${z(m)}-${z(d)} ${z(hh)}:${z(mm)}`;
}

export function localDateString(instantMs, tz) {
  const p = localParts(instantMs, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function label(instantMs, tz) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(instantMs));
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}
