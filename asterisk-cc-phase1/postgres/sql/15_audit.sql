CREATE TABLE IF NOT EXISTS audit_log (
    id           BIGSERIAL PRIMARY KEY,
    ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor        VARCHAR(80) NOT NULL,
    actor_role   VARCHAR(20),
    action       VARCHAR(80) NOT NULL,
    target       TEXT,
    payload_json JSONB,
    ip           INET,
    ua           TEXT
);

CREATE INDEX IF NOT EXISTS audit_ts_idx     ON audit_log (ts);
CREATE INDEX IF NOT EXISTS audit_actor_idx  ON audit_log (actor);
CREATE INDEX IF NOT EXISTS audit_action_idx ON audit_log (action);
CREATE INDEX IF NOT EXISTS audit_payload_gin ON audit_log USING gin (payload_json);

CREATE TABLE IF NOT EXISTS auth_log (
    id        BIGSERIAL PRIMARY KEY,
    ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
    login     VARCHAR(80) NOT NULL,
    result    VARCHAR(16) NOT NULL CHECK (result IN ('ok','fail','locked')),
    source_ip INET,
    ua        TEXT,
    reason    TEXT
);

CREATE INDEX IF NOT EXISTS auth_log_login_idx ON auth_log (login, ts DESC);
CREATE INDEX IF NOT EXISTS auth_log_result_idx ON auth_log (result, ts DESC);

CREATE TABLE IF NOT EXISTS config_changes (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor       VARCHAR(80) NOT NULL,
    file        TEXT NOT NULL,
    before_hash CHAR(64),
    after_hash  CHAR(64),
    diff        TEXT
);

CREATE INDEX IF NOT EXISTS config_changes_ts_idx ON config_changes (ts DESC);

GRANT SELECT, INSERT ON audit_log, auth_log, config_changes TO app;
GRANT SELECT ON audit_log, auth_log, config_changes TO report, auditor;

-- Helper function used by AMI listener and app endpoints.
CREATE OR REPLACE FUNCTION log_action(
    p_actor      TEXT,
    p_role       TEXT,
    p_action     TEXT,
    p_target     TEXT,
    p_payload    JSONB,
    p_ip         INET,
    p_ua         TEXT
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT;
BEGIN
    INSERT INTO audit_log (actor, actor_role, action, target, payload_json, ip, ua)
    VALUES (p_actor, p_role, p_action, p_target, p_payload, p_ip, p_ua)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION log_action(TEXT,TEXT,TEXT,TEXT,JSONB,INET,TEXT) TO app;

-- Auditor role for read-only investigations.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auditor') THEN
        CREATE ROLE auditor LOGIN PASSWORD 'changeme';
    END IF;
END $$;

GRANT CONNECT ON DATABASE asterisk_cc TO auditor;
GRANT USAGE ON SCHEMA public TO auditor;
