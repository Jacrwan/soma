-- What Soma costs. Paste into the Supabase SQL editor after ai_usage_migration.sql has run.

-- Per student, last 30 days: messages, cost, and cost per message.
SELECT u.email,
       count(*) FILTER (WHERE a.kind = 'reply')          AS replies,
       round(sum(a.cost_usd), 2)                          AS cost_usd,
       round(sum(a.cost_usd) / nullif(count(*) FILTER (WHERE a.kind = 'reply'), 0), 4) AS cost_per_reply,
       round(avg(a.output_tokens) FILTER (WHERE a.kind = 'reply'))                      AS avg_output_tokens,
       round(avg(a.input_tokens + a.cache_read_tokens + a.cache_write_tokens) FILTER (WHERE a.kind = 'reply')) AS avg_input_tokens
FROM public.ai_usage a
JOIN auth.users u ON u.id = a.user_id
WHERE a.created_at > now() - interval '30 days'
GROUP BY u.email
ORDER BY cost_usd DESC;

-- Per day, everyone: is cost going up or down after a change?
SELECT date_trunc('day', created_at) AS day, kind, model,
       count(*) AS calls, round(sum(cost_usd), 2) AS cost_usd,
       sum(cache_read_tokens) AS cache_read, sum(cache_write_tokens) AS cache_write
FROM public.ai_usage
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 2;
