-- Approved by the project owner on 2026-09-22; apply once to the intended Supabase project.
-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Somewhere for feedback and bug reports to land. Until now the only route
-- was a mailto: link on the Contact page, which loses anything a student
-- could not be bothered to write in their own mail client.
--
-- Writes go through /api/feedback, which verifies the caller and fills in
-- user_id from the token rather than trusting the body, so the table itself
-- grants nothing to the client.

BEGIN;

CREATE TABLE IF NOT EXISTS public.feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Cascades, because deleting an account has to take its data with it and a
  -- report can quote anything the student was looking at.
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('bug', 'idea', 'other')),
  message     text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  -- Where they were and what they were running, to make a report reproducible.
  page        text CHECK (page IS NULL OR char_length(page) <= 300),
  app_version text CHECK (app_version IS NULL OR char_length(app_version) <= 80),
  user_agent  text CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- No client touches this table directly; the API route writes it as the
-- service role after verifying who is asking.
REVOKE ALL ON public.feedback FROM anon, authenticated;
GRANT ALL ON public.feedback TO service_role;

CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON public.feedback (created_at DESC);

COMMENT ON TABLE public.feedback IS
  'Feedback and bug reports from the app. Written only by /api/feedback, which fills user_id from the verified token.';

COMMIT;
