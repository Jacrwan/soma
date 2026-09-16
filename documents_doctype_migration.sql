-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Adds a document "type" (syllabus, reading, guide, etc.) so the Documents
-- page can filter by it. Safe to run even if you've already run
-- documents_migration.sql — this only adds one column.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'other';
