CREATE TABLE IF NOT EXISTS queues (
    name            VARCHAR(80) PRIMARY KEY,
    description     TEXT,
    sla_seconds     INT NOT NULL DEFAULT 20,
    wrapup_seconds  INT NOT NULL DEFAULT 10,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO queues (name, description, sla_seconds) VALUES
  ('support','General support', 20),
  ('sales',  'Sales',           15),
  ('billing','Billing',         30),
  ('vip',    'VIP customers',   10),
  ('overflow','Overflow',       60)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS agents (
    id            BIGSERIAL PRIMARY KEY,
    sip_user      VARCHAR(40) UNIQUE NOT NULL,
    sip_password  VARCHAR(64) NOT NULL,
    login         VARCHAR(80) UNIQUE NOT NULL,
    full_name     TEXT,
    role          VARCHAR(20) NOT NULL DEFAULT 'agent'
                  CHECK (role IN ('agent','supervisor','qa','admin','auditor')),
    status        VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','disabled','terminated')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_queue (
    agent_id   BIGINT      NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    queue      VARCHAR(80) NOT NULL REFERENCES queues(name) ON DELETE CASCADE,
    penalty    INT NOT NULL DEFAULT 0,
    paused     BOOLEAN NOT NULL DEFAULT FALSE,
    pause_reason TEXT,
    since      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, queue)
);

CREATE TABLE IF NOT EXISTS agent_state_log (
    id          BIGSERIAL PRIMARY KEY,
    agent_id    BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    state       VARCHAR(20) NOT NULL
                CHECK (state IN ('READY','BUSY','PAUSE','AFTERCALL','LOGOUT')),
    reason      TEXT,
    started_at  TIMESTAMPTZ NOT NULL,
    ended_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_state_log_agent_idx
    ON agent_state_log (agent_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON agents, agent_queue, agent_state_log TO app;
GRANT SELECT ON agents, agent_queue, agent_state_log TO report;
