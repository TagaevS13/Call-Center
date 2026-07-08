# GSM (SoftX / UMG): IP и подсети

> **Два NIC на project (split):**  
> **SIG** — `172.16.4.19` (`enp13s4f0`) ↔ SoftX `10.1.5.8/29` via **172.16.4.1**  
> **VOICE** — `172.16.6.183` (`enp6s0f0`) ↔ UMG `10.1.5.64/27` via **172.16.6.131**

## Пары IP

| Сторона GSM           | Наш IP           | Маршрут (via / dev)      |
| --------------------- | ---------------- | ------------------------ |
| SoftX **10.1.5.8/29** (`.10`) | **172.16.4.19**  | 172.16.4.1 / enp13s4f0   |
| UMG **10.1.5.64/27** (`.75`)  | **172.16.6.183** | 172.16.6.131 / enp6s0f0  |
| WebRTC-агенты         | **172.16.6.183** | enp6s0f0 (local)         |

## Маршруты на хосте (только подсети, не /24 и не /32)

| Подсеть          | via          | dev        |
| ---------------- | ------------ | ---------- |
| 10.1.5.8/29      | 172.16.4.1   | enp13s4f0  |
| 10.1.5.64/27     | 172.16.6.131 | enp6s0f0   |

## Входящий RTP (ACL GSM)

Разрешить **UDP с любого хоста** в **`10.1.5.64/27`** → **`172.16.6.183:10000-20000`**.

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
ip route get 10.1.5.10    # via 172.16.4.1 dev enp13s4f0
ip route get 10.1.5.75    # via 172.16.6.131 dev enp6s0f0
sudo tcpdump -ni enp13s4f0 host 10.1.5.10 and port 5060 -c 5
sudo tcpdump -ni enp6s0f0 net 10.1.5.64/27 and udp -c 20
```
