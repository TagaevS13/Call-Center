# Asterisk Contact Center, Phase 1

Полный комплект артефактов для развёртывания Phase 1 ТЗ "Кол-центр на Asterisk":
PBX/ACD, IVR, запись разговоров, CTI (AMI/ARI/AGI), супервизия, базовая отчётность,
журналирование (файловые логи + Postgres), мониторинг и резервное копирование.

## Структура

- `scripts/install-native-ubuntu.sh` — установка lab на одном Ubuntu-сервере (без Docker).
- `ops/systemd/native/` — systemd-юниты для Asterisk, WebUI, coturn, мониторинга.
- `asterisk/etc/` — все `*.conf` Asterisk (PJSIP, dialplan, queues, ConfBridge, CDR/CEL, AMI/ARI, HTTP, logger, RTP).
- `asterisk/scripts/` — prestart, reload-watcher, MixMonitor, queue_log import, AMI-листенер.
- `kamailio/kamailio.cfg` — опциональный SBC перед Asterisk.
- `postgres/sql/` — DDL и миграции (cdr, cel, queue_log, recordings, agents, audit, views, partitions, retention).
- `postgres/pgbackrest/` — конфиг резервного копирования.
- `monitoring/` — Prometheus, alerts, Grafana provisioning, дашборд, fail2ban.
- `tests/` — приёмочные сценарии (sipp), smoke SQL, чек-лист.
- `ops/` — установка, runbook, GSM ([gsm-ip-reference.md](ops/gsm-ip-reference.md)), нагрузка до 300 concurrent ([load-test-300.md](ops/load-test-300.md)), WebRTC FW.
- Диагностика звука «туда и обратно» (оба плеча RTP): **[ops/audio-two-way-runbook.md](ops/audio-two-way-runbook.md)**.

## Быстрый старт (lab, native Ubuntu)

1. Скопировать `.env.example` в `.env` и заполнить значения (заменить `changeme`).
2. GSM-маршруты: `sudo bash scripts/apply-gsm-routes.sh && sudo systemctl enable --now cc-gsm-routes`
3. Проверка портов: `bash scripts/check-ports.sh`
4. Установка: `sudo bash scripts/install-native-ubuntu.sh`
5. Прогнать приёмку: `tests/acceptance_tests.md`

Подробно: **[ops/deploy-native-ubuntu.md](ops/deploy-native-ubuntu.md)**

## Production-развёртывание

См. [ops/deploy.md](ops/deploy.md). Lab на одном сервере — для разработки и приёмки. В prod каждый компонент идёт на свою VM/нод по [ops/runbook.md](ops/runbook.md).

## Lab на одном Ubuntu-сервере (native + SMSC рядом)

Пошагово: **[ops/deploy-native-ubuntu.md](ops/deploy-native-ubuntu.md)**  
Проверка портов: `bash scripts/check-ports.sh`  
Asterisk CLI: `bash scripts/asterisk-cli.sh 'pjsip show endpoints'`
