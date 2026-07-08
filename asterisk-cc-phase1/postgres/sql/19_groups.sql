-- Groups for RBAC (maps to webui/data/groups.json in Phase 1 demo).

CREATE TABLE IF NOT EXISTS groups (
    id            VARCHAR(40) PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT,
    default_role  VARCHAR(20) NOT NULL DEFAULT 'agent',
    default_penalty INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_queues (
    group_id   VARCHAR(40) NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    queue      VARCHAR(80) NOT NULL REFERENCES queues(name) ON DELETE CASCADE,
    PRIMARY KEY (group_id, queue)
);

CREATE TABLE IF NOT EXISTS agent_groups (
    agent_id   BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    group_id   VARCHAR(40) NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (agent_id, group_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON groups, group_queues, agent_groups TO app;
GRANT SELECT ON groups, group_queues, agent_groups TO report;
