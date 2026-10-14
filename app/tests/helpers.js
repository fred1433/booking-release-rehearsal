import { makeD1 } from './d1-sqlite.js';
// Monday 19 October 2026, 00:00 UTC. Paris is on summer time (UTC+2) until Sunday 25 October.
export const NOW = Date.parse('2026-10-19T00:00:00Z');
export const SANDBOX = 'test-sandbox-1';
let n = 0;
export const key = () => `key-${++n}-${Math.random().toString(36).slice(2, 8)}`;
export const fresh = () => makeD1();
export const req = (start, durationMin, extra = {}) => ({ sandbox: SANDBOX, start, durationMin, idempotencyKey: key(), learnerTz: 'Australia/Sydney', ...extra });
// Tuesday 20 October 2026, 08:00 in Paris = 06:00 UTC = 17:00 in Sydney.
export const TUE_0800 = '2026-10-20T06:00:00.000Z';
export const at = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60000).toISOString();
