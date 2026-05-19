-- SLA / ASA / abandon / AHT / occupancy materialized views.
-- Refreshed by cron every 5 minutes.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_queue_calls_5m AS
WITH calls AS (
    SELECT callid, queuename,
           min(CASE WHEN event = 'ENTERQUEUE'   THEN "time" END) AS t_enter,
           min(CASE WHEN event = 'CONNECT'      THEN "time" END) AS t_connect,
           min(CASE WHEN event = 'COMPLETEAGENT' OR event = 'COMPLETECALLER'
                    THEN "time" END) AS t_complete,
           bool_or(event = 'ABANDON') AS abandoned,
           max(CASE WHEN event = 'CONNECT' THEN data1::int END) AS hold_seconds,
           max(CASE WHEN event = 'COMPLETEAGENT' OR event = 'COMPLETECALLER'
                    THEN data2::int END) AS talk_seconds
    FROM queue_log
    WHERE "time" > now() - interval '24 hours'
    GROUP BY callid, queuename
)
SELECT date_trunc('minute', t_enter) AS bucket,
       queuename,
       count(*)                                                        AS offered,
       count(*) FILTER (WHERE NOT abandoned)                           AS handled,
       count(*) FILTER (WHERE abandoned)                               AS abandoned,
       avg(hold_seconds) FILTER (WHERE NOT abandoned)                  AS asa,
       avg(talk_seconds) FILTER (WHERE NOT abandoned)                  AS aht,
       count(*) FILTER (
           WHERE NOT abandoned
             AND hold_seconds <= COALESCE(
                  (SELECT sla_seconds FROM queues q WHERE q.name = c.queuename), 20)
       )::numeric / NULLIF(count(*),0) AS sla_share
FROM calls c
GROUP BY 1, 2;

CREATE INDEX IF NOT EXISTS mv_queue_calls_5m_idx ON mv_queue_calls_5m (queuename, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_agent_workload_5m AS
SELECT date_trunc('minute', "time") AS bucket,
       agent,
       count(*) FILTER (WHERE event = 'CONNECT')        AS connects,
       count(*) FILTER (WHERE event = 'COMPLETEAGENT')  AS completes,
       count(*) FILTER (WHERE event = 'PAUSE')          AS pauses,
       count(*) FILTER (WHERE event = 'UNPAUSE')        AS unpauses
FROM queue_log
WHERE "time" > now() - interval '24 hours'
GROUP BY 1, 2;

CREATE OR REPLACE VIEW v_queue_realtime AS
WITH waiting AS (
    SELECT q.queuename, count(*) AS waiting
    FROM queue_log q
    LEFT JOIN queue_log d
      ON d.callid = q.callid
     AND d.queuename = q.queuename
     AND d.event IN ('CONNECT','ABANDON','EXITWITHTIMEOUT','EXITWITHKEY','EXITEMPTY')
    WHERE q.event = 'ENTERQUEUE'
      AND q."time" > now() - interval '1 hour'
      AND d.id IS NULL
    GROUP BY q.queuename
)
SELECT queuename, COALESCE(waiting,0) AS waiting FROM waiting;

CREATE OR REPLACE FUNCTION refresh_dashboards()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_queue_calls_5m;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_agent_workload_5m;
EXCEPTION WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW mv_queue_calls_5m;
    REFRESH MATERIALIZED VIEW mv_agent_workload_5m;
END;
$$;

GRANT SELECT ON mv_queue_calls_5m, mv_agent_workload_5m, v_queue_realtime TO report, app;
