// Read-only query helper, copied into the Paperclip container by export_record.py.
// Usage inside the container: node pg-query.mjs "<select ...>" [param1 ...]
// Uses the postgres client bundled with the paperclipai npm package and its embedded database.
import postgres from '/usr/local/lib/node_modules/paperclipai/node_modules/postgres/src/index.js';
const [query, ...params] = process.argv.slice(2);
if (!/^\s*select\b/i.test(query || '')) { console.error('only SELECT queries are allowed'); process.exit(2); }
const sql = postgres(process.env.PAPERCLIP_DB_URL || 'postgres://paperclip:paperclip@127.0.0.1:54329/paperclip');
try { console.log(JSON.stringify(await sql.unsafe(query, params))); } finally { await sql.end(); }
