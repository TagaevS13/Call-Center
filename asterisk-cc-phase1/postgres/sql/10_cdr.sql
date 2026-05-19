-- Asterisk cdr_pgsql expects table `cdr` with the following minimum columns.
-- Partitioned by month on `start` for efficient retention.

CREATE TABLE IF NOT EXISTS cdr (
    id          BIGSERIAL,
    accountcode VARCHAR(80)  DEFAULT '',
    src         VARCHAR(80)  DEFAULT '',
    dst         VARCHAR(80)  DEFAULT '',
    dcontext    VARCHAR(80)  DEFAULT '',
    clid        VARCHAR(80)  DEFAULT '',
    channel     VARCHAR(80)  DEFAULT '',
    dstchannel  VARCHAR(80)  DEFAULT '',
    lastapp     VARCHAR(80)  DEFAULT '',
    lastdata    VARCHAR(255) DEFAULT '',
    "start"     TIMESTAMPTZ  NOT NULL,
    answer      TIMESTAMPTZ,
    "end"       TIMESTAMPTZ,
    duration    INT          DEFAULT 0,
    billsec     INT          DEFAULT 0,
    disposition VARCHAR(45)  DEFAULT '',
    amaflags    INT          DEFAULT 0,
    userfield   VARCHAR(255) DEFAULT '',
    uniqueid    VARCHAR(150) NOT NULL,
    linkedid    VARCHAR(150) DEFAULT '',
    sequence    INT          DEFAULT 0,
    PRIMARY KEY (id, "start")
) PARTITION BY RANGE ("start");

CREATE INDEX IF NOT EXISTS cdr_uniqueid_idx  ON cdr (uniqueid);
CREATE INDEX IF NOT EXISTS cdr_linkedid_idx  ON cdr (linkedid);
CREATE INDEX IF NOT EXISTS cdr_dst_idx       ON cdr (dst);
CREATE INDEX IF NOT EXISTS cdr_disposition_idx ON cdr (disposition);
CREATE INDEX IF NOT EXISTS cdr_userfield_trgm ON cdr USING gin (userfield gin_trgm_ops);

GRANT SELECT, INSERT ON cdr TO asterisk;
GRANT SELECT ON cdr TO report, app;
