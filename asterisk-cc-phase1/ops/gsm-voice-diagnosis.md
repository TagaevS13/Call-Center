# GSM: нет обратного RTP (шаблон заявки)

Использовать если во время звонка:
- `tcpdump -ni enp6s0f0 net 10.1.5.64/27 and udp` — **только Out**, нет **In** с `10.1.5.x`
- `grep "Got RTP.*10.1.5" /var/log/asterisk/full` — **пусто**

Traceroute до `10.1.5.75` с PBX **успешен** — проблема не в маршруте L3, а в **UDP RTP / ACL / UMG**.

---

## Текст для GSM

> **PBX:** `172.16.6.183` (RTP), SIP `172.16.4.19`  
> **Маршруты:** SIG `10.1.5.8/29` via `172.16.4.1`; media `10.1.5.64/27` via `172.16.6.131` — traceroute до `.10` и `.75` OK.  
> **SIP:** INVITE на 1263 доходит, ответы 100/183/200 OK.  
> **RTP исходящий:** PBX шлёт `172.16.6.183:PORT → 10.1.5.75:PORT` (tcpdump Out на `enp6s0f0`).  
> **RTP входящий:** с подсети **`10.1.5.64/27`** на **`172.16.6.183:10000-20000`** **нет** (tcpdump In = 0, Asterisk `Got RTP from 10.1.5` = 0).  
>  
> Просим:  
> 1. Разрешить **входящий UDP** `10.1.5.64/27 → 172.16.6.183:10000-20000` (все хосты `/27`, не только `.75`).  
> 2. Проверить UMG: отвечает ли RTP на адрес из SDP (`c=IN IP4 172.16.6.183`).  
> 3. Отключить **mandatory SIP preconditions** на транке к `172.16.4.19` (иначе UMG может не открыть медиа).

---

## Проверка на PBX (во время звонка)

```bash
cd /opt/call-center/asterisk-cc-phase1
bash scripts/run-gsm-voice-diagnosis.sh 8
sudo tcpdump -ni enp6s0f0 net 10.1.5.64/27 and udp -c 40
grep "Got  RTP packet from    10.1.5" /var/log/asterisk/full | tail -5
```

## Если Got RTP есть, а в браузере `in=NO-inbound-rtp`

Плечо 2 (Asterisk → агент): FW Windows + Huawei ACL 3044 — см. [firewall-webrtc-agent.md](firewall-webrtc-agent.md).
