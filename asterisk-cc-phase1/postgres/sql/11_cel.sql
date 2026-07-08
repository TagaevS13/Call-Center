-- Channel Event Logging
CREATE TABLE IF NOT EXISTS cel (
    id            BIGSERIAL,
    eventtype     VARCHAR(30)  NOT NULL,
    eventtime     TIMESTAMPTZ  NOT NULL,
    cid_name      VARCHAR(80),
    cid_num       VARCHAR(80),
    cid_ani       VARCHAR(80),
    cid_rdnis     VARCHAR(80),
    cid_dnid      VARCHAR(80),
    exten         VARCHAR(80),
    context       VARCHAR(80),
    channame      VARCHAR(80),
    appname       VARCHAR(80),
    appdata       VARCHAR(512),
    amaflags      INT,
    accountcode   VARCHAR(20),
    peeraccount   VARCHAR(20),
    uniqueid      VARCHAR(150),
    linkedid      VARCHAR(150),
    userfield     VARCHAR(255),
    peer          VARCHAR(80),
    userdeftype   VARCHAR(255),
    extra         TEXT,
    PRIMARY KEY (id, eventtime)
) PARTITION BY RANGE (eventtime);

CREATE INDEX IF NOT EXISTS cel_uniqueid_idx ON cel (uniqueid);
CREATE INDEX IF NOT EXISTS cel_linkedid_idx ON cel (linkedid);
CREATE INDEX IF NOT EXISTS cel_eventtype_idx ON cel (eventtype);

GRANT SELECT, INSERT ON cel TO asterisk;
GRANT SELECT ON cel TO report, app;
