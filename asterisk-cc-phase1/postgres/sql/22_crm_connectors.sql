-- CRM connectors: REST / SOAP (WSDL) — конструктор интеграции для карточки абонента

CREATE TABLE IF NOT EXISTS crm_connectors (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    connector_type  VARCHAR(16) NOT NULL CHECK (connector_type IN ('rest', 'soap')),
    enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    config          JSONB NOT NULL DEFAULT '{}'::jsonb,
    field_mapping   JSONB NOT NULL DEFAULT '{}'::jsonb,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_connectors_enabled_idx ON crm_connectors (enabled);

COMMENT ON TABLE crm_connectors IS 'Интеграция CRM/BSS: REST или SOAP (WSDL)';
COMMENT ON COLUMN crm_connectors.config IS 'URL, auth, operation, headers, timeout, secrets refs';
COMMENT ON COLUMN crm_connectors.field_mapping IS 'Пути ответа CRM → поля карточки CC (msisdn, name, tariff, …)';

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_connectors TO app;
GRANT USAGE, SELECT ON SEQUENCE crm_connectors_id_seq TO app;
