-- Drop monthly partitions older than retention thresholds and remove old recordings.

CREATE OR REPLACE FUNCTION drop_old_partitions(p_parent text, p_keep_months int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
    rec RECORD;
    cutoff date := (date_trunc('month', now()) - (p_keep_months || ' month')::interval)::date;
    cnt int := 0;
BEGIN
    FOR rec IN
        SELECT c.relname
        FROM pg_inherits i
        JOIN pg_class c ON i.inhrelid = c.oid
        JOIN pg_class p ON i.inhparent = p.oid
        WHERE p.relname = p_parent
          AND c.relname ~ ('^' || p_parent || '_[0-9]{6}$')
          AND right(c.relname, 6) < to_char(cutoff, 'YYYYMM')
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I', rec.relname);
        cnt := cnt + 1;
    END LOOP;
    RETURN cnt;
END;
$$;

CREATE OR REPLACE FUNCTION retention_apply()
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    cdr_drops int;
    cel_drops int;
    qlog_drops int;
    rec_deleted int;
BEGIN
    -- 13 months online for CDR/CEL/queue_log
    cdr_drops  := drop_old_partitions('cdr', 13);
    cel_drops  := drop_old_partitions('cel', 13);
    qlog_drops := drop_old_partitions('queue_log', 13);

    -- recordings: mark expired, actual file removal happens via tools/cleanup_recordings.sh
    UPDATE recordings
       SET deleted_at = now(), deleted_by = 'retention'
     WHERE retention_until < now()
       AND deleted_at IS NULL;
    GET DIAGNOSTICS rec_deleted = ROW_COUNT;

    -- audit_log/auth_log: 3 years online
    DELETE FROM audit_log WHERE ts < now() - interval '3 years';
    DELETE FROM auth_log  WHERE ts < now() - interval '3 years';

    PERFORM log_action('system','system','retention_apply', NULL,
                       jsonb_build_object('cdr_drops', cdr_drops,
                                          'cel_drops', cel_drops,
                                          'qlog_drops', qlog_drops,
                                          'recordings_marked', rec_deleted),
                       NULL, 'cron');

    RETURN jsonb_build_object('cdr_drops', cdr_drops,
                              'cel_drops', cel_drops,
                              'qlog_drops', qlog_drops,
                              'recordings_marked', rec_deleted);
END;
$$;
