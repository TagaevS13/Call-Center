# Нагрузочный тест: до 300 одновременных звонков

Цель — проверить, что **prod-развёртывание** ([deploy.md](deploy.md)) выдерживает целевую ёмкость до **300 concurrent** (≈600 каналов Asterisk: абонент + агент).

> **Lab** (`docker compose` на одном хосте) — только пилот до ~30–50 звонков. Для 300 используйте отдельные VM: **ast-a** (active), **ast-b** (standby), **db-1**, **mon-1**.

---

## 1. Предусловия

- [ ] Развёртывание по [deploy.md](deploy.md): active Asterisk, Postgres отдельно, NFS/общее хранилище для `recordings/`
- [ ] GSM/транки или **SIPp**-имитация абонентов (для изолированного теста без GSM)
- [ ] Агенты: SIP-телефоны или WebRTC (WebRTC тяжелее — тестировать отдельно)
- [ ] Grafana/Prometheus: дашборд `ops_dashboard.json`, алерт `HighConcurrentCalls` (>180) — [alerts.yml](../monitoring/prometheus/alerts.yml)
- [ ] `ulimit -n` на Asterisk ≥ **65536** (уже в `docker-entrypoint.sh` для lab)

---

## 2. Профили нагрузки (ступенчато)

| Этап | Concurrent | Длительность | Цель |
|------|------------|--------------|------|
| L-01 | 10 | 10 мин | smoke |
| L-02 | 50 | 15 мин | базовая линия метрик |
| L-03 | 100 | 15 мин | рост CPU/диска |
| L-04 | 200 | 15 мин | приближение к prod |
| L-05 | **300** | **30 мин** | целевая ёмкость |

Между этапами — **5 мин** пауза, сброс метрик в записной лист.

**Не перескакивать сразу на 300** — иначе непонятно, где узкое место.

---

## 3. Что запускать на Asterisk (каждые 30 с)

На active-ноде или в контейнере:

```bash
asterisk -rx "core show channels count"
asterisk -rx "core show channels" | tail -5
asterisk -rx "queue show" | head -40
```

Скрипт из репозитория (на сервере с docker):

```bash
cd /opt/call-center/asterisk-cc-phase1
bash scripts/load-test-snapshot.sh | tee -a load-test-$(date +%Y%m%d).log
```

---

## 4. Метрики — пороги «прошли / не прошли»

### Asterisk / голос

| Метрика | Порог OK | Где смотреть |
|---------|----------|--------------|
| Активные каналы | ≤ **650** при 300 звонках (запас) | `core show channels count`, Prometheus `asterisk_core_active_channels` |
| Односторонний RTP | **0** жалоб / нет роста `RX=0` в `pjsip show channelstats` | логи, выборочный прослушивание |
| Потеря вызовов | < **0.5%** не `ANSWERED` при стабильных агентах | `cdr` за период теста |
| CPU ast-a | среднее < **75%**, пики < **90%** | `node_exporter`, `top` |
| Load average | < **число ядер × 1.5** | `uptime` |

### Сеть

| Метрика | Порог OK |
|---------|----------|
| RTP drops / `rx overrun` | нет роста в `asterisk -rx "rtp show stats"` |
| UDP errors | `netstat -su` / `ss -s` без роста `packet receive errors` |
| Пропускная способность | запас ≥ **2×** (~150 Мбит/с пик для G.711 300×2 ноги — грубо) |

### Запись (MixMonitor)

| Метрика | Порог OK |
|---------|----------|
| Файлы в `recordings/` | ≈ числу завершённых звонков (после теста) |
| `iowait` | среднее < **15%** на NFS-клиенте |
| Запись в `recordings` (Postgres) | нет отставания > **2 мин** от конца звонка |
| Свободное место | > **20%** на томе записей |

### PostgreSQL (db-1)

| Метрика | Порог OK |
|---------|----------|
| Connections | < **80%** `max_connections` |
| Lag реплики | нет (или < 1 с если replica) |
| Disk WAL | стабильный рост, нет `checkpoint` storm в логах |

### WebRTC (если агенты в браузере)

| Метрика | Порог OK |
|---------|----------|
| F12 `[CC-RTP]` | `in=` растёт, не `NO-inbound-rtp` |
| WSS | нет массовых disconnect в `/var/log/asterisk/full` |
| coturn | CPU < **50%** при 100+ агентах за NAT |

---

## 5. Генерация нагрузки

### Вариант A — SIPp (абоненты в очередь, без GSM)

Пример (адаптировать под ваш DID/контекст):

```bash
# Установить sipp, сценарий INVITE → DTMF 1 → ожидание
sipp -sf tests/sipp/queue_enter.xml -i <LOCAL_IP> -d 30000 \
  -r 5 -l 300 <ASTERISK_VIP>:5060
```

Создайте сценарий под `from-provider` / DID из `vdn_generated.conf`. Для Phase 1 в репо может не быть готового XML — см. [acceptance_tests.md](../tests/acceptance_tests.md) T-10.

### Вариант B — реальные GSM + агенты

- 300 одновременных — только по согласованию с оператором GSM (транк).
- На PBX: параллельно `tcpdump` / `load-test-snapshot.sh`.

### Вариант C — гибрид

- 200 звонков SIPp + 100 реальных агентов WebRTC — реалистичный смешанный тест.

---

## 6. Мониторинг во время L-05 (300)

**Терминал 1** — снимки каждые 30 с:

```bash
watch -n 30 'bash scripts/load-test-snapshot.sh'
```

**Терминал 2** — Prometheus (если настроен):

```text
asterisk_core_active_channels
rate(node_cpu_seconds_total{mode="idle"}[5m])
node_filesystem_avail_bytes{mountpoint="/var/spool/asterisk/recordings"}
```

**Терминал 3** — Postgres:

```bash
psql -d asterisk_cc -c "select count(*) from cdr where start > now() - interval '5 minutes';"
psql -d asterisk_cc -c "select * from pg_stat_activity where datname='asterisk_cc';"
```

---

## 7. SQL после теста

```sql
-- Успешность за окно теста
SELECT disposition, count(*) 
FROM cdr 
WHERE start BETWEEN :t0 AND :t1 
GROUP BY 1;

-- Пик очереди
SELECT queuename, max(data) 
FROM queue_log 
WHERE time BETWEEN :t0 AND :t1 AND event = 'CONNECT'
GROUP BY 1;

-- Записи
SELECT count(*) FROM recordings WHERE created_at > :t0;
```

---

## 8. Критерий «готовы к 300 в prod»

Все пункты на этапе **L-05**:

- [ ] 300 concurrent держится **30 мин** без роста failed/one-way
- [ ] CPU/RAM/диск в порогах (раздел 4)
- [ ] Записи и CDR без отставания
- [ ] Failover **T-60** ([acceptance_tests.md](../tests/acceptance_tests.md)) пройден отдельно
- [ ] Отчёт с графиками Grafana за период L-02…L-05

---

## 9. Если не прошли

| Симптом | Вероятная причина | Действие |
|---------|-------------------|----------|
| CPU 100% | один Asterisk, transcoding | убрать лишние кодеки; только G.711; больше CPU |
| iowait высокий | запись на локальный диск | NFS/отдельный storage; отключить запись на тест / async |
| RTP one-way | сеть/FW | QoS, порты UDP, не lab single-NIC |
| Postgres connections | пул | поднять `max_connections`, PgBouncer |
| >300 в перспективе | архитектура | несколько PBX / шардинг очередей (вне Phase 1) |

---

## 10. Связанные документы

- [deploy.md](deploy.md) — prod VM
- [runbook.md](runbook.md) — эксплуатация
- [gsm-ip-reference.md](gsm-ip-reference.md) — GSM-сеть
- [acceptance_tests.md](../tests/acceptance_tests.md) — функциональная приёмка
