# Asterisk Contact Center, Phase 1

Полный комплект артефактов для развёртывания Phase 1 ТЗ "Кол-центр на Asterisk":
PBX/ACD, IVR, запись разговоров, CTI (AMI/ARI/AGI), супервизия, базовая отчётность,
журналирование (файловые логи + Postgres), мониторинг и резервное копирование.

## Структура

- `docker-compose.yml` — стенд для разработки и приёмки.
- `asterisk/etc/` — все `*.conf` Asterisk (PJSIP, dialplan, queues, ConfBridge, CDR/CEL, AMI/ARI, HTTP, logger, RTP).
- `asterisk/scripts/` — пост-скрипт MixMonitor, импорт queue_log в Postgres, AMI-листенер статусов оператора.
- `kamailio/kamailio.cfg` — опциональный SBC перед Asterisk.
- `postgres/sql/` — DDL и миграции (cdr, cel, queue_log, recordings, agents, audit, views, partitions, retention).
- `postgres/pgbackrest/` — конфиг резервного копирования.
- `monitoring/` — Prometheus, alerts, Grafana provisioning, дашборд, fail2ban.
- `tests/` — приёмочные сценарии (sipp), smoke SQL, чек-лист.
- `ops/` — пошаговая установка, runbook эксплуатации, процедура восстановления из бэкапа.

## Быстрый старт (lab)

1. Скопировать `.env.example` в `.env` и заполнить значения.
2. `docker compose up -d postgres` и применить SQL по порядку из `postgres/sql/`.
3. `docker compose up -d asterisk-a asterisk-b prometheus grafana`.
4. (Опционально) `docker compose up -d kamailio`.
5. Импортировать дашборд `monitoring/grafana/dashboards/ops_dashboard.json`.
6. Прогнать приёмку: `tests/acceptance_tests.md`.

## Production-развёртывание

См. [ops/deploy.md](ops/deploy.md). Стенд docker-compose **не** является целевой prod-конфигурацией — он нужен для разработки и приёмки. В prod каждый компонент идёт на свою VM/нод по [ops/runbook.md](ops/runbook.md).
