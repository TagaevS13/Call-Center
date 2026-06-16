-- Admin console: roles, VDN, расширение agents/queues

CREATE TABLE IF NOT EXISTS roles (
    id            VARCHAR(20) PRIMARY KEY,
    label         TEXT NOT NULL,
    permissions   JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE queues
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS service_type VARCHAR(20) NOT NULL DEFAULT 'Query';

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS password_plain VARCHAR(128),
  ADD COLUMN IF NOT EXISTS sip_password VARCHAR(64),
  ADD COLUMN IF NOT EXISTS skill_mode VARCHAR(20) NOT NULL DEFAULT 'by_group',
  ADD COLUMN IF NOT EXISTS pick_skills BOOLEAN NOT NULL DEFAULT TRUE;

DO $$ BEGIN
  ALTER TABLE agents ALTER COLUMN sip_user DROP NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE agents ADD CONSTRAINT agents_skill_mode_check
    CHECK (skill_mode IN ('by_group', 'by_skill'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS agent_assigned_skills (
    agent_id       BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_id       INT NOT NULL,
    queue_name     VARCHAR(80) NOT NULL,
    skill_name     TEXT,
    agent_rating   INT NOT NULL DEFAULT 1,
    skill_rating   INT NOT NULL DEFAULT 1,
    penalty        INT NOT NULL DEFAULT 0,
    PRIMARY KEY (agent_id, skill_id)
);

CREATE TABLE IF NOT EXISTS vdn_routes (
    id              SERIAL PRIMARY KEY,
    number          VARCHAR(32) UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    route_type      VARCHAR(32) NOT NULL
                    CHECK (route_type IN ('queue_direct', 'ivr_language')),
    skill_queue_id  INT REFERENCES queues(id) ON DELETE SET NULL,
    queue_name      VARCHAR(80) REFERENCES queues(name) ON DELETE SET NULL,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vdn_language_options (
    id              SERIAL PRIMARY KEY,
    vdn_id          INT NOT NULL REFERENCES vdn_routes(id) ON DELETE CASCADE,
    digit           CHAR(1) NOT NULL,
    lang            VARCHAR(16),
    label           TEXT,
    queue_name      VARCHAR(80),
    skill_queue_id  INT,
    sort_order      INT NOT NULL DEFAULT 0,
    UNIQUE (vdn_id, digit)
);

CREATE INDEX IF NOT EXISTS vdn_routes_number_idx ON vdn_routes (number);

GRANT SELECT, INSERT, UPDATE, DELETE ON roles, vdn_routes, vdn_language_options,
  agent_assigned_skills TO app;
GRANT SELECT ON roles, vdn_routes, vdn_language_options, agent_assigned_skills TO report;
GRANT USAGE, SELECT ON SEQUENCE vdn_routes_id_seq, vdn_language_options_id_seq TO app;

COMMENT ON TABLE vdn_routes IS 'Короткие номера / DID (VDN)';
COMMENT ON TABLE roles IS 'Роли и права Web UI';

GRANT SELECT, INSERT, UPDATE, DELETE ON subscriber_access,
  subscriber_access_queues, subscriber_access_groups TO app;
GRANT USAGE, SELECT ON SEQUENCE subscriber_access_id_seq TO app;
