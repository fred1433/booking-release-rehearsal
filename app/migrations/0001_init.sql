-- Bookings for one synthetic teacher, partitioned by visitor sandbox.
CREATE TABLE IF NOT EXISTS bookings (
  id            TEXT PRIMARY KEY,
  sandbox       TEXT NOT NULL,
  teacher_id    TEXT NOT NULL,
  start_utc     INTEGER NOT NULL,          -- epoch milliseconds, the authoritative instant
  end_utc       INTEGER NOT NULL,
  duration_min  INTEGER NOT NULL CHECK (duration_min IN (30, 45, 60)),
  teacher_tz    TEXT NOT NULL,
  learner_tz    TEXT NOT NULL,
  price_cents   INTEGER NOT NULL,
  currency      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  idem_key      TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  cancelled_at  INTEGER,
  app_sha       TEXT NOT NULL DEFAULT 'dev',
  UNIQUE (sandbox, idem_key)
);
CREATE INDEX IF NOT EXISTS bookings_by_teacher ON bookings (sandbox, teacher_id, status, start_utc);
