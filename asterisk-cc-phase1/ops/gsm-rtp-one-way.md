# GSM RTP one-way (запись есть, агент не слышит)



Split-маршруты: **10.1.5.8/29** via `172.16.4.1 dev enp13s4f0`, **10.1.5.64/27** via `172.16.6.131 dev enp6s0f0` — [gsm-network-routes.md](gsm-network-routes.md).



## Симптом



- В браузере: `ice=connected`, `out` растёт, **`in=NO-inbound-rtp`**

- В логах нет `Got RTP packet from    10.1.5` (любой хост в **`10.1.5.64/27`**)



## Проверка на PBX



```bash

cd /opt/call-center/asterisk-cc-phase1

sudo bash scripts/apply-gsm-routes.sh

bash scripts/verify-gsm-config.sh

```



Во время звонка:



```bash

sudo tcpdump -ni enp6s0f0 net 10.1.5.64/27 and udp -vv -c 30

sudo tcpdump -ni enp6s0f0 src net 10.1.5.64/27 and udp -c 5

```



Должны быть **In** и **Out** (source RTP `172.16.6.183`).



```bash

grep "Got  RTP packet from    10.1.5" /var/log/asterisk/full | tail -5

```



## Схема IP



| Подсеть | Наш IP (bind) | Маршрут |

| ------- | ------------- | ------- |

| 10.1.5.8/29 | 172.16.4.19 (SIP) | 172.16.4.1 enp13s4f0 |

| 10.1.5.64/27 | 172.16.6.183 (RTP) | 172.16.6.131 enp6s0f0 |



## Заявка GSM (ACL)



> Разрешить входящий UDP с подсети **`10.1.5.64/27`** (все хосты) на **`172.16.6.183:10000-20000`**.



## Preconditions



Просьба к GSM: отключить mandatory preconditions на транке к `172.16.4.19`.

