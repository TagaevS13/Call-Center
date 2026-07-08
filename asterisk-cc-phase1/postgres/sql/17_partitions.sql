-- Partition management for cdr / cel / queue_log.
-- Use pg_partman if available; here is a minimal manual implementation.

CREATE OR REPLACE FUNCTION ensure_month_partition(p_parent text, p_col text, p_month date)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    p_name text := format('%s_%s', p_parent, to_char(p_month, 'YYYYMM'));
    p_from text := to_char(p_month, 'YYYY-MM-01');
    p_to   text := to_char(p_month + interval '1 month', 'YYYY-MM-01');
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = p_name AND n.nspname = 'public'
    ) THEN
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
          p_name, p_parent, p_from, p_to
        );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION partition_maintenance()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    m date;
BEGIN
    FOR m IN
        SELECT (date_trunc('month', now()) + (s || ' month')::interval)::date
        FROM generate_series(-1, 2) s
    LOOP
        PERFORM ensure_month_partition('cdr', 'start', m);
        PERFORM ensure_month_partition('cel', 'eventtime', m);
        PERFORM ensure_month_partition('queue_log', 'time', m);
    END LOOP;
END;
$$;

SELECT partition_maintenance();
