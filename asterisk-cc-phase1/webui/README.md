# Web UI: Agent & Supervisor

Два статических SPA-приложения для операторов и супервизоров. Никаких сборщиков и npm; всё на vanilla JS + SIP.js (грузится с CDN).

## Быстрый просмотр (без Asterisk)

Поднимите статический сервер (обязательно для ES-модулей и `data/*.json`):

```bash
python webui/serve.py 8765
```

Откройте **портал входа**: http://localhost:8765/

| Логин | Пароль | Куда попадёте |
|---|---|---|
| `admin` | `admin` | Админ-панель |
| `supervisor` | `supervisor` | Дашборд супервизора |
| `agent01` | `agent01` | Рабочее место оператора (SIP 1001) |
| `qa01` | `qa01` | Supervisor (ограниченные права) |

После входа оператора оставьте **«Демо-режим»** в окне WebRTC — UI работает на синтетических данных без Asterisk.

Прямые ссылки (требуют активной сессии, иначе редирект на портал):

- http://localhost:8765/agent/
- http://localhost:8765/supervisor/
- http://localhost:8765/admin/

## Боевой режим (с Asterisk)

1. На Asterisk-ноде убедитесь, что включён `transport-wss` в `pjsip.conf` и `http.conf` слушает `tlsbindaddr=0.0.0.0:8089` с TLS-сертификатом (см. `asterisk/etc/pjsip.conf`, `asterisk/etc/http.conf`).
2. SIP-учётка оператора заведена в `pjsip.conf` (шаблон `agent-tpl`, см. примеры `1001..1050`).
3. Войдите на портале логином/паролем (`agents.login` в Postgres). В окне WebRTC снимите «Демо-режим», укажите WSS и домен. SIP extension и пароль подставляются из учётки оператора.
4. После регистрации входящие из очередей появятся в карточке «Активный вызов».

## Контракт UI ↔ Asterisk (что и откуда)

| Экран UI | Источник в реальном бою |
|---|---|
| Регистрация WebRTC, исходящие/входящие | SIP.js поверх `wss://…:8089/ws` (Asterisk `transport-wss`) |
| Карточка абонента (MSISDN/сегмент/тариф/баланс/VIP) | AGI/ARI `lookup_subscriber` в IVR пишет в SIP-заголовок `X-Profile` (JSON) перед `Queue()` |
| ЧС / VIP, агенты, группы, VDN (админка) | REST `/api/admin/*` → Postgres; AGI читает `subscribers_access.json` (синхронизируется при сохранении ЧС/VIP) |
| Имя очереди в карточке вызова | SIP-заголовок `X-Queue` |
| Очереди live (`waiting`, `longest`, `sla`) | REST-эндпоинт приложения над `mv_queue_calls_5m` и `v_queue_realtime` (Phase 1) или AMI `QueueStatus` |
| История звонков оператора | SQL по `cdr` + `recordings` (фильтр по `agents.sip_user`) |
| Статусы оператора в верхней панели | команды `PauseQueueMember`/`UnpauseQueueMember` + события `QueueMemberPause`/`DeviceStateChange` через `ami_state_listener.py` пишут в `agent_state_log` |
| Wrap-up формы | INSERT в таблицу обращений (Phase 2) или в `audit_log.payload_json` (Phase 1) |
| Supervisor: agents grid | таблица `agents` + последние записи `agent_state_log` |
| Supervisor: Listen/Whisper/Barge | вызов диалплана `*33/*34` через ARI `originate` Local-канала + `ChanSpy` |
| Supervisor: Pause/Unpause/Remove | AMI `QueuePause`/`QueueRemove` |
| Audit feed | таблица `audit_log` (включая события `supervisorspy`, `supervisorwhisper` из `ami_state_listener.py`) |

## Интеграция с бэкендом (Phase 1 минимум)

Чтобы оба UI работали в боевом, нужен **тонкий REST-шлюз** к Postgres и AMI/ARI (любая реализация — Node/Python/Go). Контракт:

- `GET  /api/queues/realtime` — массив `{name, waiting, longest, offered, handled, abandoned, sla, ops}`
- `GET  /api/agents`          — массив `{id, sip, name, state, since, queues, call}`
- `POST /api/agents/{sip}/pause`   `{reason}`
- `POST /api/agents/{sip}/unpause`
- `POST /api/agents/{sip}/remove`  `{queue}`
- `POST /api/spy/{sip}` `{mode: "listen"|"whisper"|"barge", actor}`
- `GET  /api/audit?limit=50`
- `GET  /api/cdr?agent=...&from=...&to=...`
- `GET  /api/recordings/{uniqueid}` — отдаёт файл записи с проверкой роли и записью в `audit_log`

Шлюз — это Phase 1.5 (на текущем этапе UI работает в демо-режиме либо берёт данные напрямую через AMI/ARI без REST-обёртки).
