-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Records when the focus timer was paused during a session, so the calendar
-- can draw those stretches faint instead of as studied time. A paused session
-- is still saved as one row from Start to Stop; duration_seconds already
-- counts only the time the timer ran.
--
-- Adds one nullable column and modifies no existing row. Sessions saved before
-- this ran (or with no pause) stay NULL and are drawn solid, as before. Until
-- it runs, the app saves sessions without their pauses.

ALTER TABLE timer_sessions
  ADD COLUMN IF NOT EXISTS pauses JSONB;

COMMENT ON COLUMN timer_sessions.pauses IS
  'Pauses during the session as [[from, to], ...] seconds after start_time. NULL means none recorded.';
