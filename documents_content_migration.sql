-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Adds extracted-text storage so the AI can read document content (syllabi,
-- readings, guides) for deadlines, policies, and general context. Safe to run
-- even if you've already run the other documents_*.sql migrations.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS extracted_text TEXT,
  ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS extraction_error TEXT;
