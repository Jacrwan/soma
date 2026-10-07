-- Token counts and cost per AI call, per user, so Soma's real cost per student
-- can be measured (added 2026-10-06 with the move to Sonnet 5.5). Numbers
-- only, never message text. Run once on the Supabase project; until then the
-- server logs "ai_usage_not_saved" and replies are unaffected.
BEGIN;
CREATE TABLE public.ai_usage (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('reply', 'memory')),
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens integer NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens integer NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cost_usd numeric(12, 6)
);
CREATE INDEX ai_usage_user_time ON public.ai_usage (user_id, created_at);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
-- Written and read by the server only; no client access.
REVOKE ALL ON public.ai_usage FROM anon, authenticated;
GRANT ALL ON public.ai_usage TO service_role;
COMMENT ON TABLE public.ai_usage IS 'Token counts and cost per AI call. No message content. Account deletion cascades.';
COMMIT;
