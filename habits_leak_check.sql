-- Read-only check, 2026-11-17. Changes nothing.
--
-- Until today, a second account signing in on the same browser was shown the
-- previous account's habits, and adding or checking one saved that whole list
-- into the second account's settings. This lists every account whose saved
-- habits have the same names as another account's, so you can see who was
-- affected. Paste into Supabase → SQL Editor → Run.
--
-- Two accounts sharing habits is not proof by itself (two students can both
-- have "Gym"); identical lists of several habits almost always are.

WITH h AS (
  SELECT s.user_id,
         u.email,
         u.created_at::date AS joined,
         (SELECT string_agg(lower(trim(i->>'title')), ' | ' ORDER BY lower(trim(i->>'title')))
            FROM jsonb_array_elements(s.data->'habits'->'items') i) AS habit_names,
         jsonb_array_length(s.data->'habits'->'items') AS how_many
  FROM settings s
  JOIN auth.users u ON u.id = s.user_id
  WHERE jsonb_typeof(s.data->'habits'->'items') = 'array'
    AND jsonb_array_length(s.data->'habits'->'items') > 0
)
SELECT habit_names, how_many, count(*) AS accounts,
       string_agg(email || ' (joined ' || joined || ')', ', ' ORDER BY joined) AS who
FROM h
GROUP BY habit_names, how_many
HAVING count(*) > 1
ORDER BY how_many DESC, accounts DESC;

-- To clear one affected account's habits (after checking it's the copy, not
-- their own), replace the email and run:
--
-- UPDATE settings SET data = data - 'habits'
-- WHERE user_id = (SELECT id FROM auth.users WHERE email = 'student@example.com');
