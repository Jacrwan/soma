-- Run this in your Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Each student's education level and, for college and grad students, the
-- university they picked, as one readable table. Afterwards: Table Editor →
-- schema dropdown (top left, says "public") → admin → user_education.
--
-- The answers stay where the app saves them (settings.data: educationLevel,
-- university {name, country}); this only reads them. No table or row is
-- changed, and the view always shows the current answers.
--
-- Who can read it: the view joins auth.users for emails, so it lives in its
-- own "admin" schema, which the app's API doesn't expose, and anon and
-- authenticated get no access to it. Only you (the dashboard) and the service
-- role can read it. Don't add "admin" to Settings → API → Exposed schemas.
--
-- To remove it: DROP SCHEMA admin CASCADE;

CREATE SCHEMA IF NOT EXISTS admin;
REVOKE ALL ON SCHEMA admin FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW admin.user_education AS
SELECT u.id                                   AS user_id,
       u.email,
       u.created_at                           AS signed_up_at,
       CASE s.data->>'educationLevel'
         WHEN 'middle'  THEN 'Middle School'
         WHEN 'high'    THEN 'High School'
         WHEN 'college' THEN 'College / University'
         WHEN 'grad'    THEN 'Graduate / Post-grad'
         WHEN 'other'   THEN 'Other'
         ELSE s.data->>'educationLevel'       -- null: never answered
       END                                    AS education_level,
       -- Only college and grad students are asked; null for everyone else.
       CASE WHEN s.data->>'educationLevel' IN ('college', 'grad')
            THEN s.data->'university'->>'name' END    AS university,
       CASE WHEN s.data->>'educationLevel' IN ('college', 'grad')
            THEN s.data->'university'->>'country' END AS university_country
FROM auth.users u
LEFT JOIN public.settings s ON s.user_id = u.id;

REVOKE ALL ON admin.user_education FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA admin TO service_role;
GRANT SELECT ON admin.user_education TO service_role;

-- Optional lookups (read-only; run any one on its own after the view exists):

-- How many students at each level
-- SELECT coalesce(education_level, 'Not answered') AS level, count(*)
-- FROM admin.user_education GROUP BY 1 ORDER BY 2 DESC;

-- How many students at each university
-- SELECT university, university_country, count(*)
-- FROM admin.user_education WHERE university IS NOT NULL
-- GROUP BY 1, 2 ORDER BY 3 DESC;
