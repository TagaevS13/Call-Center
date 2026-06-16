# GSM RTP one-way (запись есть, агент не слышит)

**Маршруты на хосте:** `10.1.5.8/29` (сигналинг), `10.1.5.64/27` (медиа) via `172.16.4.1 dev enp13s4f0` — [gsm-network-routes.md](gsm-network-routes.md).

## Симптом

- В браузере: `ice=connected`, `out` растёт, `**in=NO-inbound-rtp`**
- На сервере в `/var/log/asterisk/full` за время разговора:
  - **Есть** `Got RTP` с `192.168.1.103` (микрофон агента)
  - **Нет** `Got RTP packet from    10.1.5` (голос с UMG **10.1.5.64/27**, хост **10.1.5.75**)

Пример (звонок 2026-06-04 09:31):

```
6747 192.168.1.103:65038   ← только агент
0    10.1.5.x              ← абонент с GSM не приходит
```

Asterisk **отправляет** RTP на `10.1.5.75:61084`, но **не получает** обратно.

Это не брандмауэр ПК агента — медиа абонента не доходит до Asterisk.

## Сначала на PBX (наша сторона)

```bash
cd /opt/call-center/asterisk-cc-phase1
sudo bash scripts/apply-gsm-routes.sh
bash scripts/verify-gsm-config.sh
```

Ожидается: маршруты `10.1.5.8/29`, `10.1.5.64/27`, `10.1.5.0/24` via **172.16.4.1 dev enp13s4f0**; **нет** `/32`; `ip route get 10.1.5.75 from 172.16.4.19` → **src 172.16.4.19**.

Во время звонка на **enp13s4f0**:

```bash
sudo tcpdump -ni enp13s4f0 net 10.1.5.64/27 and udp -vv -c 30
```

Должны быть **In** и **Out** с `172.16.4.19`. Если только Out — смотреть маршрут/rp_filter на PBX, не GSM.

После теста:

```bash
grep "Got  RTP packet from    10.1.5" /var/log/asterisk/full | tail
```

## Схема IP (GSM)


| Подсеть / хост GSM                    | Наш IP           |
| ------------------------------------- | ---------------- |
| **10.1.5.8/29** (SoftX **10.1.5.10**) | **172.16.4.19**  |
| **10.1.5.64/27** (UMG **10.1.5.75**)  | **172.16.4.19** |

`10.1.5.75` — хост UMG в подсети `/27`, не отдельный маршрут `/32`.

В SDP к UMG: `c=IN IP4 172.16.4.19`. WebRTC-агенты: `172.16.6.183`.

## Правки на PBX (уже в репо)

- `pjsip_provider.conf`: `media_address=172.16.4.19` (`GSM_MEDIA_ADDRESS`), `bind_rtp_to_media_address=yes`, `match=10.1.5.8/29` и `10.1.5.64/27`
- `rtp.conf`: без `localnet` для `10.x` (иначе RTP к GSM уходит с `.4.19`)
- `pjsip.conf` (agent): `bundle=no`, `bind_rtp_to_media_address=no`, `rtp_keepalive=15`
- `rtp.conf`: `rtcpinterval=5000`, `strictrtp=no`

После появления RTP с `10.1.5.75` мост передаст голос на WebRTC; в браузере `in=` в `[CC-RTP]` начнёт расти.