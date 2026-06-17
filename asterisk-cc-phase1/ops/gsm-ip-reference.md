# GSM (SoftX / UMG): IP и подсети

Единая схема для маршрутов Linux, PJSIP `match=` и тикетов сетевикам.

> **Важно:** маршруты и `pjsip match=` задаются **только подсетями** (`10.1.5.8/29`,
> `10.1.5.64/27`, `10.1.5.0/24`). В SDP на каждый звонок `c=IN IP4` может быть любой хост
> UMG внутри `10.1.5.64/27` (напр. `10.1.5.72`) — диагностика смотрит на **любой** `10.1.5.x`.

## Подсети (маршруты + identify) — обязательно


| Роль                  | Подсеть          |
| --------------------- | ---------------- |
| Сигналинг SIP (SoftX) | **10.1.5.8/29**  |
| Медиа RTP (UMG)       | **10.1.5.64/27** |
| Общий маршрут (доп.)  | **10.1.5.0/24**  |


**Не использовать** в `ip route` и `pjsip match`: `/32` на отдельные хосты GSM.

## Пары IP с нашим PBX (project)


| Сторона GSM              | Наш IP                           |
| ------------------------ | -------------------------------- |
| SoftX **10.1.5.8/29**    | **172.16.4.19** (SIP)            |
| UMG **10.1.5.64/27**     | **172.16.4.19** (RTP/SDP к UMG)  |
| WebRTC-агенты            | **172.16.6.183** (`PUBLIC_DOMAIN`) |


## Переменные `.env`

```env
SIP_PROVIDER_SIGNAL_NET=10.1.5.8/29
SIP_PROVIDER_MEDIA_NET=10.1.5.64/27
GSM_ROUTE_NET=10.1.5.0/24
GSM_ROUTE_SIGNAL_NET=10.1.5.8/29
GSM_ROUTE_MEDIA_NET=10.1.5.64/27
GSM_ROUTE_VIA=172.16.4.1
GSM_ROUTE_DEV=enp13s4f0
```

`SIP_PROVIDER_*_NET` и `GSM_ROUTE_*` — подсети для Asterisk, API и `apply-gsm-routes.sh`.

## Проверка на сервере

```bash
bash scripts/verify-gsm-config.sh
```

См. также [gsm-network-routes.md](gsm-network-routes.md), [gsm-rtp-one-way.md](gsm-rtp-one-way.md).
