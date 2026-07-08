# Runbook эксплуатации Phase 1

## Статус системы за 60 секунд

```bash
# маршрут GSM (project, два NIC)
ip r | grep 10.1.5   # expect /24, /29, /27 — not /32
bash scripts/verify-gsm-config.sh
# на каждой ноде Asterisk
asterisk -rx "core show channels count"
asterisk -rx "queue show"
asterisk -rx "pjsip show endpoints" | head -30

# в Postgres
psql -d asterisk_cc -c "select count(*) from cdr where start > now() - interval '5 min';"
psql -d asterisk_cc -c "select * from v_queue_realtime;"
```

Алерт-центры: Grafana → Alerting; Prometheus → Alertmanager; см. `monitoring/prometheus/alerts.yml`.

## Типовые инциденты

| Симптом | Диагностика | Действие |
|---|---|---|
| Очередь набирает wait > SLA | `queue show <Q>`, `v_queue_realtime` | Проверить онлайн-операторов, поднять резерв; включить overflow |
| Asterisk active не звонит | `core show channels count`, `pjsip show contacts` | keepalived failover на ast-b, расследование на ast-a |
| Записи не появляются в `recordings` | Логи `mixmonitor_post.sh`, права на `/var/spool/asterisk/recordings` | Перезапуск пост-скрипта, проверка диска |
| Падает запись в `cdr` | `messages`/`full`, статус Postgres | Проверить `cdr_pgsql.conf`, доступность БД |
| Подбор пароля SIP | `security` log, fail2ban jail | Проверить блокировки, расширить правила |

## Регламентные работы

- Ежедневно: проверка алертов, контроль свободного места `recordings` и WAL Postgres.
- Еженедельно: ревью `audit_log` за неделю на аномалии (массовые ChanSpy, изменения членства).
- Ежемесячно: ревью емкости (concurrent calls peak), план по транковой ёмкости; см. [load-test-300.md](load-test-300.md).
- Ежеквартально: тест восстановления Postgres из pgBackRest (см. `ops/backup_restore.md`).
- Ежегодно: ротация сертификатов CA/PJSIP TLS/WSS.

## Релиз конфигов Asterisk

1. Изменения только в git-репозитории `asterisk-config`.
2. PR с code review.
3. Pre-commit hook кладёт diff в `config_changes` (см. `15_audit.sql`).
4. CI прогоняет `asterisk -T -c -x "dialplan reload"` в lab.
5. Применение: сначала на standby, дым-тест, потом на active.
