# Приёмочные тесты Phase 1

Все тесты прогоняются на стенде, поднятом по `ops/deploy.md`. Зелёные результаты — обязательное условие открытия трафика на провайдера.

## 1. Базовая телефония

| ID | Сценарий | Ожидаемый результат |
|---|---|---|
| T-01 | Регистрация SIP-аккаунта 1001 (TLS) | `pjsip show contacts` показывает 1 контакт; в `audit_log` нет ошибок |
| T-02 | Регистрация WebRTC-оператора 1002 (wss) | Контакт ws виден; обмен SRTP/DTLS установлен |
| T-03 | Звонок 1001 → 1002 | RTP двусторонний, в `cdr` строка с `disposition='ANSWERED'`, в `cel` — события `CHAN_START/ANSWER/HANGUP` |

## 2. Очереди и IVR

| ID | Сценарий | Ожидаемый результат |
|---|---|---|
| T-10 | sipp UAC дозванивается на DID и нажимает 1 | Попадает в `support`, поднимает оператор 1001 |
| T-11 | 5 очередей опубликованы (`queue show`) | `support, sales, billing, vip, overflow` |
| T-12 | 50 операторов 1001..1050 онлайн | `pjsip show endpoints | grep -c ': Avail'` = 50 |
| T-13 | Звонок без операторов → выходит из очереди по таймауту → переход в `overflow` | В `queue_log` события `EXITWITHTIMEOUT`, затем `ENTERQUEUE` для overflow |
| T-14 | IVR хождение в Postgres через AGI `lookup_subscriber` | В `cdr.userfield` появляются `segment` и `lang` |

## 3. Запись разговоров

| ID | Сценарий | Ожидаемый результат |
|---|---|---|
| T-20 | После завершения вызова из T-10 | Файл `recordings/YYYY/MM/DD/<uniqueid>...wav` создан |
| T-21 | В таблице `recordings` появилась строка | SHA-256 совпадает с `sha256sum` файла |
| T-22 | Просмотр записи QA-ролью | Доступ разрешён; в `audit_log` `action=recording_view` |

## 4. Супервизия

| ID | Сценарий | Ожидаемый результат |
|---|---|---|
| T-30 | Супервизор набирает `*33<sip>` для прослушивания | Слышит разговор; в `audit_log` событие `supervisorspy` |
| T-31 | Команда `*34<sip>` (whisper) | Оператор слышит супервизора, абонент — нет; событие `supervisorwhisper` в `audit_log` |
| T-32 | Принудительная пауза оператора через AMI | `agent_state_log` фиксирует переход в `PAUSE` |

## 5. Журналирование и BI

| ID | Сценарий | Ожидаемый результат |
|---|---|---|
| T-40 | После часа теста запустить `refresh_dashboards()` | `mv_queue_calls_5m` содержит ненулевые SLA/ASA/AHT по `support` |
| T-41 | Trace одного вызова | По `linkedid` восстанавливается цепочка `cdr` ↔ `cel` ↔ `recordings` ↔ `queue_log` |
| T-42 | Проверка партиций | `partition_maintenance()` создаёт партиции на текущий и +2 месяца |

## 6. Безопасность

| ID | Сценарий | Ожидаемый результат |
|---|---|---|
| T-50 | 6 неудачных регистраций с одного IP | fail2ban банит IP; событие в `auth_log` `result='fail'` |
| T-51 | AMI-логин неверным паролем | Запись в `security` логе; нет успешного `Login` |
| T-52 | Изменение `extensions.conf` через git → reload | Строка в `config_changes` с `before_hash`/`after_hash`/`diff` |

## 7. HA / DR

| ID | Сценарий | Ожидаемый результат |
|---|---|---|
| T-60 | Останов active-ноды | keepalived переносит VIP на standby за < 10 с; новые звонки работают |
| T-61 | Тест восстановления Postgres из pgBackRest | Скрипт `restore_test.sh` зелёный; `audit_log` отмечает событие |

## Скрипты приёмки

- `tests/sipp/uac_inbound.xml` — sipp-сценарий имитации входящего вызова с DTMF.
- `tests/smoke.sql` — выборка количества строк по ключевым таблицам и trace вызова по `linkedid`.
- `tests/verify_recordings.sh` — sample-проверка SHA-256 на 1% записей.
