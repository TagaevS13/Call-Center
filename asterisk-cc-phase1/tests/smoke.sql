-- Smoke checks after a test run.

\echo '== Row counts (last hour) =='
SELECT 'cdr'        AS t, count(*) FROM cdr        WHERE start    > now() - interval '1 hour'
UNION ALL
SELECT 'cel',          count(*) FROM cel          WHERE eventtime > now() - interval '1 hour'
UNION ALL
SELECT 'queue_log',    count(*) FROM queue_log    WHERE "time"    > now() - interval '1 hour'
UNION ALL
SELECT 'recordings',   count(*) FROM recordings   WHERE started_at > now() - interval '1 hour'
UNION ALL
SELECT 'audit_log',    count(*) FROM audit_log    WHERE ts        > now() - interval '1 hour';

\echo '== Latest call trace =='
WITH last AS (
    SELECT linkedid FROM cdr WHERE start > now() - interval '15 min'
    ORDER BY start DESC LIMIT 1
)
SELECT 'cdr' AS src, "start" AS ts, src AS a, dst AS b, disposition AS info
  FROM cdr WHERE linkedid = (SELECT linkedid FROM last)
UNION ALL
SELECT 'cel', eventtime, channame, exten, eventtype
  FROM cel WHERE linkedid = (SELECT linkedid FROM last)
UNION ALL
SELECT 'queue', "time", queuename, agent, event
  FROM queue_log WHERE callid IN (
        SELECT uniqueid FROM cdr WHERE linkedid = (SELECT linkedid FROM last)
  )
UNION ALL
SELECT 'rec', started_at, queue, agent_id::text, file_path
  FROM recordings WHERE linkedid = (SELECT linkedid FROM last)
ORDER BY ts;

\echo '== SLA last hour =='
SELECT queuename, sum(offered) offered, sum(handled) handled, sum(abandoned) abandoned,
       round(avg(asa)::numeric,1) asa, round(avg(aht)::numeric,1) aht,
       round(avg(sla_share)::numeric,3) sla_share
FROM mv_queue_calls_5m
WHERE bucket > now() - interval '1 hour'
GROUP BY queuename ORDER BY queuename;
