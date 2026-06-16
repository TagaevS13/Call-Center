# Маршрутизация к GSM

Сводка IP/подсетей: **[gsm-ip-reference.md](gsm-ip-reference.md)**.

Хост **project**: `172.16.6.183` (enp6s0f0) + `172.16.4.19` (enp13s4f0 → шлюз **172.16.4.1**).

Подсети GSM (от сисадмина GSM):


| Назначение    | Было           | Стало              |
| ------------- | -------------- | ------------------ |
| Сигналинг SIP | `10.1.5.10/32` | `**10.1.5.8/29`**  |
| Медиа RTP     | `10.1.5.75/32` | `**10.1.5.64/27**` |


**Хосты в подсетях** (для tcpdump/логов, не для `match=`): SoftX **10.1.5.10**, UMG **10.1.5.75**.

Схема GSM (пары IP):


| Подсеть GSM        | Пример хоста | Наш хост (SIP/RTP)            |
| ------------------ | ------------ | ----------------------------- |
| **10.1.5.8/29**    | 10.1.5.10    | **172.16.4.19** (enp13s4f0)  |
| **10.1.5.64/27**   | 10.1.5.75    | **172.16.4.19** (enp13s4f0) |

Маршруты и PJSIP `match=` — только **подсети** `/29` и `/27`, не `/32`.  
`10.1.5.75` — адрес UMG **внутри** `10.1.5.64/27` (для tcpdump), не отдельный маршрут `/32`.

В SDP к медиа-подсети: `c=IN IP4 172.16.4.19` (`GSM_MEDIA_ADDRESS`, `bind_rtp_to_media_address=yes`).  
WebRTC-агенты: **172.16.6.183** (`PUBLIC_DOMAIN`).

---

## Маршруты на хосте

```bash
sudo ip route replace 10.1.5.0/24 via 172.16.4.1 dev enp13s4f0
sudo ip route replace 10.1.5.8/29 via 172.16.4.1 dev enp13s4f0
sudo ip route replace 10.1.5.64/27 via 172.16.4.1 dev enp13s4f0
sudo bash /opt/call-center/asterisk-cc-phase1/scripts/apply-gsm-routes.sh
```

Проверка:

```bash
ip route get 10.1.5.10
ip route get 10.1.5.75
```

---

## Asterisk PJSIP identify

В `pjsip_provider.conf` (после entrypoint):

```
match=10.1.5.8/29
match=10.1.5.64/27
```

`.env`:

```env
SIP_PROVIDER_SIGNAL_NET=10.1.5.8/29
SIP_PROVIDER_MEDIA_NET=10.1.5.64/27
```

Перезапуск: `docker compose restart asterisk-a`

---

## Постоянно после reboot

```bash
sudo systemctl enable --now cc-gsm-routes.service
# или netplan: ops/netplan/99-cc-gsm-routes.yaml.example
```

