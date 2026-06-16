-- Абоненты: чёрный список (ЧС) и VIP
-- ЧС: бессрочно или период; на все очереди или выбранные — абонент не дозванивается
-- VIP: без ожидания — приоритетная маршрутизация в VIP-очередь (Asterisk Queue position)

CREATE TABLE IF NOT EXISTS subscriber_access (
  id              SERIAL PRIMARY KEY,
  msisdn          VARCHAR(20) NOT NULL,
  list_type       VARCHAR(16) NOT NULL CHECK (list_type IN ('blacklist', 'vip')),
  scope           VARCHAR(16) NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'selected')),
  permanent       BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from      DATE,
  valid_until     DATE,
  reason          TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      VARCHAR(64),
  UNIQUE (msisdn, list_type)
);

CREATE TABLE IF NOT EXISTS subscriber_access_queues (
  access_id       INT NOT NULL REFERENCES subscriber_access(id) ON DELETE CASCADE,
  queue_name      VARCHAR(64) NOT NULL,
  PRIMARY KEY (access_id, queue_name)
);

CREATE TABLE IF NOT EXISTS subscriber_access_groups (
  access_id       INT NOT NULL REFERENCES subscriber_access(id) ON DELETE CASCADE,
  group_id        VARCHAR(64) NOT NULL,
  PRIMARY KEY (access_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriber_access_msisdn ON subscriber_access (msisdn);
CREATE INDEX IF NOT EXISTS idx_subscriber_access_type ON subscriber_access (list_type) WHERE enabled;

COMMENT ON TABLE subscriber_access IS 'ЧС и VIP абонентов (CSP Subscriber Access)';
COMMENT ON COLUMN subscriber_access.scope IS 'all = все направления; selected = только привязанные очереди/группы';
