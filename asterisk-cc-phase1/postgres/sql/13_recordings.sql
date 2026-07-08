CREATE TABLE IF NOT EXISTS recordings (
    uniqueid         VARCHAR(150) PRIMARY KEY,
    linkedid         VARCHAR(150),
    queue            VARCHAR(80),
    agent_id         BIGINT,
    caller           VARCHAR(80),
    callee           VARCHAR(80),
    file_path        TEXT NOT NULL,
    file_size        BIGINT,
    codec            VARCHAR(16),
    sha256           CHAR(64),
    started_at       TIMESTAMPTZ NOT NULL,
    ended_at         TIMESTAMPTZ,
    archived_at      TIMESTAMPTZ,
    retention_until  TIMESTAMPTZ,
    deleted_at       TIMESTAMPTZ,
    deleted_by       VARCHAR(80)
);

CREATE INDEX IF NOT EXISTS rec_linkedid_idx ON recordings (linkedid);
CREATE INDEX IF NOT EXISTS rec_started_idx  ON recordings (started_at);
CREATE INDEX IF NOT EXISTS rec_agent_idx    ON recordings (agent_id);

GRANT SELECT, INSERT, UPDATE ON recordings TO asterisk, app;
GRANT SELECT ON recordings TO report;
