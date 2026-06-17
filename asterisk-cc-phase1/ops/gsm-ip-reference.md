# GSM (SoftX / UMG): IP и подсети

> **Два NIC на project:**  
> **172.16.4.19** (`enp13s4f0`) — **сигналинг** SoftX `10.1.5.8/29`  
> **172.16.6.183** (`enp6s0f0`) — **медиа** UMG `10.1.5.64/27` + WebRTC агенты

## Пары IP


| Сторона GSM           | Наш IP              | Интерфейс   |
| --------------------- | ------------------- | ----------- |
| SoftX **10.1.5.8/29** | **172.16.4.19**     | enp13s4f0   |
| UMG **10.1.5.64/27**  | **172.16.6.183**    | enp6s0f0    |
| WebRTC-агенты         | **172.16.6.183**    | enp6s0f0    |


## Маршруты

| Подсеть          | via          | dev        |
| ---------------- | ------------ | ---------- |
| 10.1.5.8/29      | 172.16.4.1   | enp13s4f0  |
| 10.1.5.64/27     | 172.16.6.131 | enp6s0f0   |

## `.env`

```env
PUBLIC_DOMAIN=172.16.6.183
GSM_MEDIA_ADDRESS=172.16.6.183
GSM_SIGNAL_ADDRESS=172.16.4.19
SIP_PROVIDER_SIGNAL_NET=10.1.5.8/29
SIP_PROVIDER_MEDIA_NET=10.1.5.64/27
GSM_ROUTE_SIGNAL_VIA=172.16.4.1
GSM_ROUTE_SIGNAL_DEV=enp13s4f0
GSM_ROUTE_MEDIA_VIA=172.16.6.131
GSM_ROUTE_MEDIA_DEV=enp6s0f0
```

## Проверка

```bash
bash scripts/verify-gsm-config.sh
ping -c 2 -I enp13s4f0 10.1.5.10    # сигналинг OK
ping -c 2 -I enp6s0f0 10.1.5.75     # медиа OK
```
