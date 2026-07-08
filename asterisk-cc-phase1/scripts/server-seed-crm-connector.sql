-- Seed default CRM connector (run once on server if seed_admin skipped crm_connectors.json)
INSERT INTO crm_connectors (name, connector_type, enabled, is_default, config, field_mapping, description)
SELECT
  'Builtin REST (тест)',
  'rest',
  TRUE,
  TRUE,
  '{"method":"GET","url":"http://127.0.0.1:9000/api/crm/builtin/{{msisdn}}","timeout":10,"auth":{"type":"none"}}'::jsonb,
  '{"msisdn":"msisdn","name":"fullName","tariff":"tariffPlan","balance":"balance","category":"category","segment":"segment","imsi":"imsi","customer_code":"customerCode","account_code":"accountCode"}'::jsonb,
  'Внутренний REST для проверки конструктора'
WHERE NOT EXISTS (SELECT 1 FROM crm_connectors WHERE is_default = TRUE);
