// Fires three overlapping bookings (60, 30 and 45 minutes) at the same instant, several times,
// each round in a fresh sandbox, and counts how many were confirmed.
// Usage: node scripts/race.mjs <api-base> [rounds] [sandbox-prefix]
// Example: node scripts/race.mjs https://theaipipe.com/demos/paperclip-booking-rehearsal/app/api 5
const [base, rounds = 5, prefix = 'race'] = process.argv.slice(2);
if (!base) { console.error('usage: node scripts/race.mjs <api-base> [rounds] [prefix]'); process.exit(2); }
const post = (b) => fetch(`${base}/bookings`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
}).then((r) => r.status);

const out = [];
for (let i = 0; i < Number(rounds); i++) {
  const sandbox = `${prefix}-${Date.now().toString(36)}-${i}`;
  let start = null;
  for (let d = 2; d < 12 && !start; d++) {
    const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
    const s = await (await fetch(`${base}/slots?sandbox=${sandbox}&date=${date}&durationMin=60`)).json();
    start = s.slots.find((x) => x.free)?.start ?? null;
  }
  const at = (m) => new Date(Date.parse(start) + m * 60000).toISOString();
  const codes = await Promise.all([
    post({ sandbox, start, durationMin: 60, idempotencyKey: `a-${sandbox}` }),
    post({ sandbox, start: at(30), durationMin: 30, idempotencyKey: `b-${sandbox}` }),
    post({ sandbox, start: at(15), durationMin: 45, idempotencyKey: `c-${sandbox}` }),
  ]);
  const list = (await (await fetch(`${base}/bookings?sandbox=${sandbox}`)).json()).bookings
    .filter((b) => b.status === 'confirmed');
  out.push({ sandbox, codes, confirmed: list.length });
}
console.log(JSON.stringify(out));
const bad = out.filter((r) => r.confirmed > 1).length;
console.log(bad ? `${bad} of ${out.length} rounds double-booked the teacher` : `no double booking in ${out.length} rounds`);
