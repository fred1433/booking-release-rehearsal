import { createBooking, cancelBooking, listBookings, listSlots, BookingError, TEACHER, LEARNER_TZ, DURATIONS } from './booking.js';

const json = (status, body) => new Response(JSON.stringify(body, null, 2), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
});

async function api(request, env, path) {
  const url = new URL(request.url);
  const db = env.DB;
  const opts = { appSha: env.GIT_SHA || 'dev' };
  if (path === '/api/health') {
    const ping = await db.prepare('SELECT COUNT(*) AS n FROM bookings').first();
    return json(200, { ok: true, env: env.ENV_NAME || 'dev', sha: env.GIT_SHA || 'dev', deployedAt: env.DEPLOYED_AT || null, bookingsStored: ping.n });
  }
  if (path === '/api/config' && request.method === 'GET') {
    return json(200, { teacher: { name: TEACHER.name, tz: TEACHER.tz, currency: TEACHER.currency, prices: TEACHER.prices }, learnerTz: LEARNER_TZ, durations: DURATIONS });
  }
  if (path === '/api/slots' && request.method === 'GET') {
    const slots = await listSlots(db, {
      sandbox: url.searchParams.get('sandbox'), date: url.searchParams.get('date'),
      durationMin: url.searchParams.get('durationMin'), learnerTz: url.searchParams.get('learnerTz') || LEARNER_TZ,
    });
    return json(200, { slots });
  }
  if (path === '/api/bookings' && request.method === 'GET') {
    return json(200, { bookings: await listBookings(db, url.searchParams.get('sandbox')) });
  }
  if (path === '/api/bookings' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const r = await createBooking(db, body, opts);
    return json(r.status, { booking: r.booking, replayed: r.replayed });
  }
  const m = path.match(/^\/api\/bookings\/([0-9a-f-]{36})\/cancel$/);
  if (m && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const r = await cancelBooking(db, { sandbox: body.sandbox, id: m[1] });
    return json(r.status, r);
  }
  return json(404, { error: 'not_found' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const base = env.BASE || '';
    if (base && url.pathname === base) return Response.redirect(`${url.origin}${base}/`, 308);
    if (base && !url.pathname.startsWith(base + '/')) return new Response('Not found', { status: 404 });
    const path = url.pathname.slice(base.length) || '/';
    if (path.startsWith('/api/')) {
      try { return await api(request, env, path); }
      catch (e) {
        if (e instanceof BookingError) return json(e.status, { error: e.code, message: e.message });
        return json(500, { error: 'internal', message: 'unexpected error' });
      }
    }
    const res = await env.ASSETS.fetch(new Request(new URL(path, url.origin), request));
    const out = new Response(res.body, res);
    out.headers.set('x-robots-tag', 'noindex, nofollow');
    return out;
  },
};
