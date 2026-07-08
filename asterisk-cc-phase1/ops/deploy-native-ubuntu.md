# Развёртывание КЦ (native) на одном Ubuntu-сервере

> Пример: `172.16.6.183`, рядом уже работает **SMSC**.  
> Цель — **lab/stage** через systemd, native.

---

## 0. Что поднимаем

| Сервис | systemd unit | Порты | Назначение |
|--------|--------------|-------|------------|
| PostgreSQL 16 | `postgresql` | **5433** | CDR, CEL, queue_log, agents |
| Asterisk 20 | `asterisk` + `cc-*` | 5060/5061, 8088/8089, RTP | голос, очереди, запись |
| Web UI | `cc-webui` | **9000**, **9443** | портал / агент WebRTC |
| coturn | `cc-coturn` | 3478, 49160–49200 | TURN для WebRTC |
| Prometheus | `prometheus` | **9091** | метрики |
| Grafana | `grafana-server` | **3001** | дашборды |
| fail2ban | `fail2ban` | host | защита SIP |

---

## 1. Подготовка сервера

```bash
ssh sorbon@172.16.6.183

sudo apt-get update
sudo apt-get install -y git curl ca-certificates
```

### GSM-маршруты (split: /29 + /27)

```bash
sudo bash scripts/apply-gsm-routes.sh
sudo systemctl enable --now cc-gsm-routes
ip r | grep 10.1.5   # только /29 и /27
```

Подробно: [gsm-network-routes.md](gsm-network-routes.md).

---

## 2. Скопировать проект

```bash
sudo mkdir -p /opt/call-center
sudo chown sorbon:sorbon /opt/call-center
cd /opt/call-center
git clone https://github.com/TagaevS13/Call-Center.git .
cd asterisk-cc-phase1
```

Или с Windows:

```powershell
scp -r C:\Users\ADMIN\CC\asterisk-cc-phase1 sorbon@172.16.6.183:/opt/call-center/
```

---

## 3. Конфигурация

```bash
cd /opt/call-center/asterisk-cc-phase1
cp .env.example .env
# Заменить все changeme
bash scripts/gsm-env-ensure.sh .env
bash scripts/check-ports.sh
```

---

## 4. Установка (один скрипт)

```bash
sudo bash scripts/install-native-ubuntu.sh
```

Скрипт:
- ставит пакеты (postgresql, asterisk, coturn, prometheus, grafana, fail2ban)
- создаёт `/etc/cc/cc.env`, симлинки `/etc/asterisk` → репозиторий
- инициализирует БД из `postgres/sql/`
- создаёт venv WebUI, systemd-юниты из `ops/systemd/native/`
- запускает все сервисы

---

## 5. Проверка

```bash
systemctl status asterisk cc-webui cc-coturn prometheus grafana-server
asterisk -rx 'core show version'
asterisk -rx 'pjsip show endpoints'
psql -h 127.0.0.1 -p 5433 -U postgres -d asterisk_cc -c '\dt'
curl -sI http://127.0.0.1:9000/
```

URL:
- Web UI: `http://172.16.6.183:9000/`
- Agent: `https://172.16.6.183:9443/agent/`
- Grafana: `http://172.16.6.183:3001/`
- Prometheus: `http://172.16.6.183:9091/`

Приёмка: [tests/acceptance_tests.md](../tests/acceptance_tests.md)

---

## 6. Firewall (ufw)

```bash
sudo ufw allow 22/tcp
sudo ufw allow 9000/tcp
sudo ufw allow 9443/tcp
sudo ufw allow 5060/udp
sudo ufw allow 5061/tcp
sudo ufw allow 8089/tcp
sudo ufw allow 10000:20000/udp
sudo ufw allow 3478/udp
sudo ufw allow 49160:49200/udp
sudo ufw allow from 172.16.0.0/12 to any port 3001
sudo ufw allow from 172.16.0.0/12 to any port 9091
```

WebRTC на ПК агента: [firewall-webrtc-agent.md](firewall-webrtc-agent.md)

---

## 7. Обновление конфигов

После правок в `asterisk/etc/`:

```bash
sudo systemctl start cc-asterisk-prestart
sudo asterisk -rx 'module reload res_pjsip.so'
sudo asterisk -rx 'dialplan reload'
```

Web UI синхронизирует агентов/очереди через `cc_config_sync.py` и `.reload_requested`.

---

### Быстрое восстановление systemd (Asterisk не стартует после reboot)

На сервере:

```bash
cd /opt/call-center/asterisk-cc-phase1
sudo bash scripts/fix-native-stack.sh
```

Скрипт: убирает сломанный drop-in `asterisk.service.d`, ставит `cc-asterisk.service`, отключает Debian `asterisk.service`, поднимает зависимые юниты.

---

## 8. Удаление Docker (если остался на сервере)

```bash
sudo systemctl stop docker docker.socket containerd 2>/dev/null || true
sudo apt-get purge -y docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin docker.io
sudo apt-get autoremove -y
sudo rm -rf /var/lib/docker /var/lib/containerd /etc/docker
sudo ip link delete docker0 2>/dev/null || true

# Native install
cd /opt/call-center/asterisk-cc-phase1
sudo bash scripts/install-native-ubuntu.sh
```

---

## 9. Автодеплой с Windows

```powershell
$env:CC_DEPLOY_PASS = "..."
python scripts/remote-deploy-native.py
```

---

## 10. Дальнейшие шаги (prod roadmap)

1. REST API для Web UI (Phase 1.5)
2. NFS для recordings
3. Kamailio SBC (`apt install kamailio`)
4. HA: второй Asterisk + keepalived
5. Сменить demo-пароли в `webui/data/users.json`

Полный prod: [deploy.md](deploy.md) (multi-VM).
