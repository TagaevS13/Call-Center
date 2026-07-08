# Маршрутизация к GSM

Сводка IP/подсетей: **[gsm-ip-reference.md](gsm-ip-reference.md)**.

Хост **project**: `172.16.6.183` (enp6s0f0, RTP) + `172.16.4.19` (enp13s4f0, SIP).

## Split-маршруты

| Подсеть GSM      | Наш IP (bind)                 | via / dev              |
| ---------------- | ----------------------------- | ---------------------- |
| **10.1.5.8/29**  | SIP **172.16.4.19**           | 172.16.4.1 / enp13s4f0 |
| **10.1.5.64/27** | RTP **172.16.6.183**          | 172.16.6.131 / enp6s0f0 |

Только **подсети** `/29` и `/27` — не `/32`, не blanket `10.1.5.0/24`.

**Входящий RTP:** с **любого** адреса в `10.1.5.64/27` → `172.16.6.183`.

---

## Применить на хосте

```bash
sudo ip route replace 10.1.5.8/29 via 172.16.4.1 dev enp13s4f0
sudo ip route replace 10.1.5.64/27 via 172.16.6.131 dev enp6s0f0
sudo bash /opt/call-center/asterisk-cc-phase1/scripts/apply-gsm-routes.sh
```

Проверка:

```bash
ip r | grep 10.1.5
bash scripts/verify-gsm-config.sh
```

---

## Asterisk PJSIP identify

```
match=10.1.5.8/29
match=10.1.5.64/27
```

Перезапуск: `systemctl restart asterisk cc-asterisk-prestart`

---

## Постоянно после reboot

```bash
sudo systemctl enable --now cc-gsm-routes.service
# или netplan: ops/netplan/99-cc-gsm-routes.yaml.example
```
