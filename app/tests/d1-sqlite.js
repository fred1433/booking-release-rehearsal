// A small in-memory stand-in for the Cloudflare D1 API, backed by node:sqlite.
// Every call yields to the event loop first, so concurrent requests interleave
// the way they can in production (read, then another request, then write).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));

export function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const stmt = (sql, params = []) => ({
    sql, params,
    bind: (...p) => stmt(sql, p),
    async first() { await tick(); return db.prepare(sql).get(...params) ?? null; },
    async all() { await tick(); return { results: db.prepare(sql).all(...params) }; },
    async run() { await tick(); const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    // D1 batches run as one transaction: all statements commit or none do.
    async batch(list) {
      await tick();
      db.exec('BEGIN');
      try {
        const out = list.map((s) => {
          const st = db.prepare(s.sql);
          if (/^\s*select/i.test(s.sql)) return { results: st.all(...s.params) };
          const r = st.run(...s.params);
          return { success: true, meta: { changes: Number(r.changes) } };
        });
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
