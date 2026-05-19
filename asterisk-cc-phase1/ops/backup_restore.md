# Бэкапы и восстановление

## Postgres (pgBackRest)

- Конфиг: `postgres/pgbackrest/pgbackrest.conf`.
- Расписание: full еженедельно, diff ежедневно, WAL-archive непрерывно.
- Хранение: 4 недели full, 13 месяцев diff/WAL, 5 лет архивных копий full в S3.

### Полное восстановление

```bash
systemctl stop postgresql
pgbackrest --stanza=cc restore --delta
systemctl start postgresql
psql -d asterisk_cc -c "select max(start) from cdr;"
```

### PITR

```bash
pgbackrest --stanza=cc --type=time --target="2026-05-04 12:00:00" restore
```

## Записи разговоров

- Горячий слой: NFS/Ceph на `/var/spool/asterisk/recordings`.
- Архив: ежесуточная синхронизация в S3 lifecycle (Glacier через 30 дней).
- Целостность: SHA-256 в `recordings.sha256`. Скрипт `tests/verify_recordings.sh` проверяет sample 1% за день.

## Логи

- `journald` + `/var/log/asterisk/*` → rsyslog → Loki/ELK.
- Локально: `logrotate` 30 дней.
- Архив: 13 месяцев в S3.

## Тест восстановления (ежеквартально)

1. Поднять отдельный VM, восстановить Postgres из бэкапа за вчерашний день.
2. Восстановить 100 записей разговоров из S3.
3. Проверить совпадение SHA-256.
4. Прогнать `tests/smoke.sql` — ожидаемое количество строк в `cdr`/`cel`/`queue_log`.
5. Зафиксировать отчёт в `audit_log` (`action=backup_restore_test`).
