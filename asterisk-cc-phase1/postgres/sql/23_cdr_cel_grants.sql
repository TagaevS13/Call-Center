-- CDR/CEL inserts via cdr_pgsql / cel_pgsql (sequences + partitions)

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO asterisk;

-- Ensure current/next month partitions exist
SELECT partition_maintenance();
