// The race script must fail loudly: when nothing can be booked, and when the teacher is double-booked.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/race.mjs', import.meta.url));

function stub(mode) {
  const stored = new Map();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const sb = url.searchParams.get('sandbox');
    if (url.pathname.endsWith('/health')) return send(200, { sha: 'stub', env: mode });
    if (url.pathname.endsWith('/slots')) return send(200, { slots: [{ start: '2030-01-01T06:00:00.000Z', free: true }] });
    if (url.pathname.endsWith('/bookings') && req.method === 'GET') return send(200, { bookings: stored.get(sb) ?? [] });
    let body = ''; for await (const c of req) body += c; body = JSON.parse(body);
    const list = stored.get(body.sandbox) ?? []; stored.set(body.sandbox, list);
    if (mode === 'down') return send(503, { error: 'unavailable' });
    const booking = { id: `${body.sandbox}-${list.length}`, status: 'confirmed' };
    if (mode === 'double' || list.length === 0) { list.push(booking); return send(201, { booking }); }
    return send(409, { error: 'slot_taken' });
  });
  return new Promise((r) => server.listen(0, () => r(server)));
}

function run(port, ...extra) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script, `http://127.0.0.1:${port}/api`, '2', ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

for (const [mode, expect, code] of [['ok', 'fixed', 0], ['down', 'fixed', 1], ['double', 'fixed', 1], ['double', 'defect', 0], ['ok', 'defect', 1]]) {
  test(`stub "${mode}" with --expect ${expect} exits ${code}`, async () => {
    const server = await stub(mode);
    const r = await run(server.address().port, '--expect', expect);
    server.close();
    assert.equal(r.code, code, r.out);
  });
}
