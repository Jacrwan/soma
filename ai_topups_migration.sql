-- One-time top-ups that add to a student's monthly Soma budget (added
-- 2026-10-06). Written by the Stripe webhook when a top-up payment completes;
-- counted until the student's next monthly reset. Run once on Supabase, after
-- ai_usage_migration.sql.
BEGIN;
CREATE TABLE public.ai_topups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  stripe_session_id text NOT NULL UNIQUE,
  amount_usd numeric(8, 2) NOT NULL CHECK (amount_usd >= 0)
);
CREATE INDEX ai_topups_user_time ON public.ai_topups (user_id, created_at);
ALTER TABLE public.ai_topups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_topups FROM anon, authenticated;
GRANT ALL ON public.ai_topups TO service_role;
COMMENT ON TABLE public.ai_topups IS 'Paid Soma top-ups (dollars of AI use). Account deletion cascades.';
COMMIT;
