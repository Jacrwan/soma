-- Lets ai_usage record the cheap first pass that sorts each Soma message
-- (and answers small talk) as its own kind, so reports count replies
-- correctly (added 2026-10-06). Run once, after ai_usage_migration.sql.
BEGIN;
ALTER TABLE public.ai_usage DROP CONSTRAINT IF EXISTS ai_usage_kind_check;
ALTER TABLE public.ai_usage ADD CONSTRAINT ai_usage_kind_check CHECK (kind IN ('reply', 'memory', 'triage'));
COMMIT;
