-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Adds support for connecting multiple Google accounts, each with its own
-- set of calendars to sync — replaces the old single-token Calendar
-- connection (settings.googleToken), which stays untouched but unused.
--
-- Tokens in this table are only ever read/written server-side with the
-- service role key — the client never queries this table directly.

CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  google_email            TEXT        NOT NULL,
  refresh_token           TEXT        NOT NULL,
  access_token            TEXT,
  access_token_expires_at TIMESTAMPTZ,
  selected_calendars      JSONB       NOT NULL DEFAULT '[]', -- [{id, summary, backgroundColor, primary}]
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, google_email)
);

CREATE INDEX IF NOT EXISTS google_calendar_connections_user_id_idx
  ON google_calendar_connections (user_id);

ALTER TABLE google_calendar_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own calendar connections"
  ON google_calendar_connections FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
