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
- `ops/` — установка, runbook, GSM ([gsm-ip-reference.md](ops/gsm-ip-reference.md)), нагрузка до 300 concurrent ([load-test-300.md](ops/load-test-300.md)), WebRTC FW.
- Диагностика звука «туда и обратно» (оба плеча RTP): **[ops/audio-two-way-runbook.md](ops/audio-two-way-runbook.md)**.

## Быстрый старт (lab)

1. Скопировать `.env.example` в `.env` и заполнить значения.
2. `docker compose up -d postgres` и применить SQL по порядку из `postgres/sql/`.
3. `docker compose up -d asterisk-a asterisk-b prometheus grafana`.
4. (Опционально) `docker compose up -d kamailio`.
5. Импортировать дашборд `monitoring/grafana/dashboards/ops_dashboard.json`.
6. Прогнать приёмку: `tests/acceptance_tests.md`.

## Production-развёртывание

См. [ops/deploy.md](ops/deploy.md). Стенд docker-compose **не** является целевой prod-конфигурацией — он нужен для разработки и приёмки. В prod каждый компонент идёт на свою VM/нод по [ops/runbook.md](ops/runbook.md).

## Lab на одном Ubuntu-сервере (Docker + SMSC рядом)

Пошагово: **[ops/deploy-docker-ubuntu.md](ops/deploy-docker-ubuntu.md)**  
Проверка портов: `bash scripts/check-ports.sh`

## Lab на сервере project (legacy note)

```bash
# С Windows — полная установка SMSC + CC lab:
powershell -File ~\deploy\upload-and-install.ps1

# Проверка:
sudo /tmp/project-server/scripts/07-verify.sh
sudo /tmp/project-server/scripts/07b-lab-acceptance.sh
```

Lab `.env`: `PG_HOST=127.0.0.1` (Asterisk использует `network_mode: host`).
Prod-миграция: `sudo /tmp/project-server/scripts/08-prod-migration-prep.sh`
