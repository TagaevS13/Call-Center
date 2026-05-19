# Развёртывание Phase 1 (production)

Документ описывает шаги выкатки на 4 VM:
- `db-1` — PostgreSQL 16 + pgBackRest
- `ast-a`, `ast-b` — Asterisk 20 LTS, active/standby через keepalived
- `mon-1` — Prometheus + Grafana + Loki + asterisk-exporter
- (Опц.) `sbc-1` — Kamailio

## 0. Подготовка

- ОС: Rocky Linux 9 / AlmaLinux 9 (или Ubuntu LTS 24.04).
- NTP `chrony`, единый часовой пояс `Asia/Dushanbe` (default — уточнить).
- Voice VLAN, QoS DSCP EF на RTP, BE на signaling.
- Внутренний CA, сертификаты для PJSIP TLS и WebRTC `wss://`.
- DNS-имя для оператора: `cc.example.local` → A1/A2 через keepalived VIP.

## 1. PostgreSQL (db-1)

1. Установить пакет `postgresql-server-16`, инициировать кластер.
2. В `pg_hba.conf` разрешить TLS-подключения с `ast-a`, `ast-b`, `mon-1`.
3. Применить SQL по порядку:
   ```bash
   for f in 00_extensions 10_cdr 11_cel 12_queue_log 13_recordings 14_agents_queues 15_audit 16_views_sla 17_partitions 18_retention; do
     psql -U postgres -d asterisk_cc -f postgres/sql/${f}.sql
   done
   ```
4. Создать пользователя `asterisk` (CDR/CEL писатель), `app` (приложение оператора), `report` (read-only) — см. `15_audit.sql`.
5. Поднять pgBackRest по `postgres/pgbackrest/pgbackrest.conf`.
6. Завести cron на `partition_maintenance.sh` и `retention_apply.sh`.

## 2. Asterisk (ast-a, ast-b)

1. Поставить Asterisk 20 LTS, модули `cdr_pgsql`, `cel_pgsql`, `res_pjsip`, `app_confbridge`, `app_queue`, `res_ari*`, `res_http_websocket`.
2. Скопировать `asterisk/etc/*.conf` в `/etc/asterisk/` (через git-репозиторий конфигов и pre-commit hook, см. раздел 8 ТЗ).
3. Скопировать `asterisk/scripts/*` в `/opt/cc/scripts/`, выставить владельца `asterisk:asterisk`, права `0750`.
4. Поднять `keepalived` с VIP для SIP/WSS, общий сторадж записей через NFS (или Ceph RBD) на `/var/spool/asterisk/recordings`.
5. `systemctl enable --now asterisk` на active, на standby — `systemctl enable asterisk` (запуск только при failover-скрипте).
6. Запустить `ami_state_listener.py` под systemd (см. `asterisk/scripts/ami_state_listener.service`).
7. Cron на `queue_log_import.py` каждую минуту.

## 3. Monitoring (mon-1)

1. Prometheus: смонтировать `monitoring/prometheus/prometheus.yml` и `alerts.yml`.
2. Grafana: автопровижининг через `monitoring/grafana/provisioning/`. Импортировать `monitoring/grafana/dashboards/ops_dashboard.json`.
3. asterisk-exporter — на каждой ноде Asterisk локально (см. `docker-compose.yml`, профиль prod).
4. fail2ban на ast-a/ast-b с `monitoring/fail2ban/`.
5. Loki/rsyslog: пробросить `/var/log/asterisk/*` и `journald` в централизованное хранилище.

## 4. (Опц.) Kamailio SBC (sbc-1)

1. Поставить `kamailio` 5.7+, скопировать `kamailio/kamailio.cfg`.
2. Настроить публичный IP, TLS, anti-fraud rate-limit модули.
3. Маршрутизировать в Asterisk VIP.

## 5. Smoke и приёмка

См. `tests/acceptance_tests.md`. Без зелёной приёмки prod не открывается на провайдера.
