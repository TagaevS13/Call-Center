# GSM (SoftX / UMG): IP и подсети

Единая схема для маршрутов Linux, PJSIP `match=` и тикетов сетевикам.

## Подсети (маршруты + identify) — обязательно


| Роль                  | Подсеть          | Пример хоста в подсети       |
| --------------------- | ---------------- | ---------------------------- |
| Сигналинг SIP (SoftX) | **10.1.5.8/29**  | **10.1.5.10**                |
| Медиа RTP (UMG)       | **10.1.5.64/27** | **10.1.5.75**                |
| Общий маршрут (доп.)  | **10.1.5.0/24**  | via `172.16.4.1` `enp13s4f0` |


**Не использовать** в `ip route` и `pjsip match`: `10.1.5.10/32`, `10.1.5.75/32`.

## Пары IP с нашим PBX (project)


| Сторона GSM                             | Наш IP                           |
| --------------------------------------- | -------------------------------- |
| SoftX **10.1.5.10** (в **10.1.5.8/29**) | **172.16.4.19** (SIP)            |
| UMG **10.1.5.75** (в **10.1.5.64/27**)  | **172.16.4.19** (RTP/SDP к UMG)  |
| WebRTC-агенты                           | **172.16.6.183** (`PUBLIC_DOMAIN`) |


## Переменные `.env`

```env
SIP_PROVIDER_SIGNAL=10.1.5.10
SIP_PROVIDER_MEDIA=10.1.5.75
SIP_PROVIDER_SIGNAL_NET=10.1.5.8/29
SIP_PROVIDER_MEDIA_NET=10.1.5.64/27
GSM_ROUTE_NET=10.1.5.0/24
GSM_ROUTE_SIGNAL_NET=10.1.5.8/29
GSM_ROUTE_MEDIA_NET=10.1.5.64/27
GSM_ROUTE_VIA=172.16.4.1
GSM_ROUTE_DEV=enp13s4f0
```

`SIP_PROVIDER_SIGNAL` / `MEDIA` — **имена узлов** (документация, API).  
`SIP_PROVIDER_*_NET` и `GSM_ROUTE_`* — **подсети** для Asterisk и `apply-gsm-routes.sh`.

## Проверка на сервере

```bash
bash scripts/verify-gsm-config.sh
```

См. также [gsm-network-routes.md](gsm-network-routes.md), [gsm-rtp-one-way.md](gsm-rtp-one-way.md).