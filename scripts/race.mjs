// Fires three overlapping bookings (60, 30 and 45 minutes) at the same instant, in a fresh sandbox
// per round, and checks the outcome against what the release is expected to do.
//
// Usage: node scripts/race.mjs <api-base> [rounds] [--expect fixed|defect] [--prefix name]
//   --expect fixed  (default) every round must have exactly one 201, the others 409, and exactly
//                   one confirmed booking stored, which is the winner's booking.
//   --expect defect for the seeded baseline: a round passes only if more than one booking was confirmed.
// Exits 1 if any round fails, if a request returns any other status, or if the API is unreachable.
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const [base, roundsArg = '5'] = pos;
const expect = flag('--expect', 'fixed');
const prefix = flag('--prefix', 'race');
if (!base || !['fixed', 'defect'].includes(expect)) {
  console.error('usage: node scripts/race.mjs <api-base> [rounds] [--expect fixed|defect] [--prefix name]');
  process.exit(2);
}

async function json(res) { try { return await res.json(); } catch { return null; } }
const post = async (b) => {
  const res = await fetch(`${base}/bookings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return { status: res.status, body: await json(res) };
};

let health = null;
try { health = await json(await fetch(`${base}/health`)); } catch {}
const out = [];
let failed = 0;
for (let i = 0; i < Number(roundsArg); i++) {
  const sandbox = `${prefix}-${Date.now().toString(36)}-${i}`;
  const problems = [];
  let start = null;
  try {
    for (let d = 2; d < 12 && !start; d++) {
      const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      const s = await json(await fetch(`${base}/slots?sandbox=${sandbox}&date=${date}&durationMin=60`));
      start = s?.slots?.find((x) => x.free)?.start ?? null;
    }
  } catch (e) { problems.push(`slots unreachable: ${e.message}`); }
  if (!start) {
    problems.push('no free hour found');
    out.push({ sandbox, ok: false, problems }); failed++; continue;
  }
  const at = (m) => new Date(Date.parse(start) + m * 60000).toISOString();
  let res = [];
  try {
    res = await Promise.all([
      post({ sandbox, start, durationMin: 60, idempotencyKey: `a-${sandbox}` }),
      post({ sandbox, start: at(30), durationMin: 30, idempotencyKey: `b-${sandbox}` }),
      post({ sandbox, start: at(15), durationMin: 45, idempotencyKey: `c-${sandbox}` }),
    ]);
  } catch (e) { problems.push(`booking request failed: ${e.message}`); }
  const codes = res.map((r) => r.status);
  let confirmed = [];
  try { confirmed = ((await json(await fetch(`${base}/bookings?sandbox=${sandbox}`)))?.bookings ?? []).filter((b) => b.status === 'confirmed'); }
  catch (e) { problems.push(`listing failed: ${e.message}`); }
  const odd = codes.filter((c) => c !== 201 && c !== 409);
  if (odd.length) problems.push(`unexpected status ${odd.join(',')}`);
  if (expect === 'fixed') {
    const winners = res.filter((r) => r.status === 201);
    if (winners.length !== 1) problems.push(`${winners.length} requests confirmed, expected exactly 1`);
    if (codes.filter((c) => c === 409).length !== 2) problems.push('expected two 409 conflicts');
    if (confirmed.length !== 1) problems.push(`${confirmed.length} bookings stored, expected 1`);
    else if (winners.length === 1 && winners[0].body?.booking?.id !== confirmed[0].id) problems.push('stored booking is not the winner');
  } else if (confirmed.length < 2) problems.push(`expected the defect (more than one booking), got ${confirmed.length}`);
  const ok = problems.length === 0;
  if (!ok) failed++;
  out.push({ sandbox, codes, confirmed: confirmed.length, ok, ...(ok ? {} : { problems }) });
}
console.log(JSON.stringify({ base, release: health?.sha ?? null, env: health?.env ?? null, expect, rounds: out }));
console.log(failed ? `FAIL: ${failed} of ${out.length} rounds did not match --expect ${expect}` : `OK: ${out.length} of ${out.length} rounds match --expect ${expect}`);
process.exit(failed ? 1 : 0);
