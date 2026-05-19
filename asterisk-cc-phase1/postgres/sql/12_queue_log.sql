CREATE TABLE IF NOT EXISTS queue_log (
    id        BIGSERIAL,
    "time"    TIMESTAMPTZ NOT NULL,
    callid    VARCHAR(80),
    queuename VARCHAR(80),
    agent     VARCHAR(80),
    event     VARCHAR(64),
    data1     VARCHAR(255),
    data2     VARCHAR(255),
    data3     VARCHAR(255),
    data4     VARCHAR(255),
    data5     VARCHAR(255),
    raw       TEXT,
    src_node  VARCHAR(64),
    PRIMARY KEY (id, "time")
) PARTITION BY RANGE ("time");

CREATE INDEX IF NOT EXISTS qlog_callid_idx     ON queue_log (callid);
CREATE INDEX IF NOT EXISTS qlog_queue_idx      ON queue_log (queuename);
CREATE INDEX IF NOT EXISTS qlog_agent_idx      ON queue_log (agent);
CREATE INDEX IF NOT EXISTS qlog_event_idx      ON queue_log (event);

CREATE TABLE IF NOT EXISTS queue_log_offset (
    src_file TEXT PRIMARY KEY,
    inode    BIGINT,
    pos      BIGINT NOT NULL DEFAULT 0,
    updated  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON queue_log TO asterisk, app;
GRANT SELECT ON queue_log TO report;
GRANT SELECT, INSERT, UPDATE ON queue_log_offset TO app;
