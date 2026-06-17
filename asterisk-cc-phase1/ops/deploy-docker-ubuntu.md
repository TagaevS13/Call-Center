# Развёртывание КЦ (Docker) на одном Ubuntu-сервере

> Пример: `172.16.6.183`, рядом уже работает **SMSC**.  
> Цель — **lab/stage** через `docker compose`, без остановки SMSC.

---

## 0. Что поднимаем

| Сервис | Контейнер | Порты на хосте (по умолчанию) | Назначение |
|--------|-----------|-------------------------------|------------|
| PostgreSQL 16 | `postgres` | **5433** → 5432 | CDR, CEL, queue_log, agents, audit |
| Asterisk 20 | `asterisk-a` | **host** (5060/5061, 8088/8089, RTP) | голос, очереди, запись |
| Prometheus | `prometheus` | **9091** → 9090 | метрики |
| Grafana | `grafana` | **3001** → 3000 | дашборды |
| Web UI | `webui` | **9000** | портал оператора/супервизора |
| fail2ban | `fail2ban` | host (логи Asterisk) | защита SIP |

**Не поднимаем на первом шаге:** `asterisk-b` (HA), `kamailio` (SBC) — профили `ha` / `sbc`.

---

## 1. Подготовка сервера (под пользователем с sudo)

```bash
ssh sorbon@172.16.6.183

# Docker (если ещё нет)
sudo apt-get update
sudo apt-get install -y git curl ca-certificates
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker sorbon
# перелогиниться или: newgrp docker

docker compose version   # нужен v2+
```

### 1b. Маршруты к GSM (10.1.5.0/24 + 10.1.5.8/29 + 10.1.5.64/27)

На **project** через **enp13s4f0** → **172.16.4.1** (подсети `/29` и `/27`, не `/32` на хост):

```bash
cd /opt/call-center/asterisk-cc-phase1
sudo bash scripts/apply-gsm-routes.sh
sudo systemctl enable --now cc-gsm-routes.service
```

Проверка: `ip r | grep 10.1.5` → `10.1.5.8/29`, `10.1.5.64/27` via `172.16.4.1 dev enp13s4f0`.  
Подробно: [ops/gsm-network-routes.md](gsm-network-routes.md).

---

## 2. Скопировать проект на сервер

**Вариант A — git (рекомендуется):**

```bash
sudo mkdir -p /opt/call-center
sudo chown sorbon:sorbon /opt/call-center
cd /opt/call-center
git clone https://github.com/TagaevS13/Call-Center.git .
cd asterisk-cc-phase1
```

**Вариант B — с Windows (PowerShell):**

```powershell
scp -r C:\Users\ADMIN\CC\asterisk-cc-phase1 sorbon@172.16.6.183:/opt/call-center/
```

На сервере: `cd /opt/call-center/asterisk-cc-phase1`

---

## 3. Проверить конфликты портов с SMSC

```bash
bash scripts/check-ports.sh
```

Если порт занят — см. раздел **«Конфликты портов»** в конце файла.

---

## 4. Настроить `.env`

```bash
cp .env.example .env
nano .env
```

**Обязательно сменить** все `changeme` на свои пароли (не использовать пароль от SSH).

Минимум для lab на одном сервере:

```env
PG_HOST=127.0.0.1
PG_PORT=5433
PG_DB=asterisk_cc
PG_USER=asterisk
PG_PASSWORD=<сильный-пароль>
PG_SUPER_USER=postgres
PG_SUPER_PASSWORD=<сильный-пароль>

ASTERISK_AMI_USER=cti
ASTERISK_AMI_PASSWORD=<сильный-пароль>
GRAFANA_ADMIN_PASSWORD=<сильный-пароль>

PUBLIC_DOMAIN=172.16.6.183

# GSM (SoftX / UMG) — подсети для маршрутов и PJSIP identify (не /32)
SIP_PROVIDER_SIGNAL_NET=10.1.5.8/29
SIP_PROVIDER_MEDIA_NET=10.1.5.64/27
GSM_ROUTE_NET=10.1.5.0/24
GSM_ROUTE_SIGNAL_NET=10.1.5.8/29
GSM_ROUTE_MEDIA_NET=10.1.5.64/27
GSM_ROUTE_VIA=172.16.4.1
GSM_ROUTE_DEV=enp13s4f0
```

Или: `bash scripts/gsm-env-ensure.sh .env`

> Asterisk в `network_mode: host` ходит в Postgres на **127.0.0.1:5433** (проброс с контейнера postgres).

---

## 5. TLS для WebRTC (минимум для lab)

Asterisk ждёт сертификаты:

```bash
sudo mkdir -p asterisk/etc/keys
sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout asterisk/etc/keys/asterisk.key \
  -out asterisk/etc/keys/asterisk.pem \
  -subj "/CN=172.16.6.183"
sudo chmod 644 asterisk/etc/keys/asterisk.pem
sudo chmod 600 asterisk/etc/keys/asterisk.key
```

В `webui` для операторов WSS: `wss://172.16.6.183:8089/ws` (самоподписанный — в Chrome нужно принять исключение).

---

## 6. Запуск по шагам

### Шаг 6.1 — только Postgres

```bash
cd /opt/call-center/asterisk-cc-phase1
docker compose up -d postgres
docker compose logs -f postgres   # дождаться "database system is ready"
```

Проверка:

```bash
docker compose exec postgres psql -U postgres -d asterisk_cc -c '\dt'
```

Должны появиться таблицы `cdr`, `cel`, `queue_log`, `agents`, … (инициализация из `postgres/sql/`).

Если таблиц нет — см. **«Troubleshooting: пустая БД»**.

### Шаг 6.2 — Asterisk

```bash
docker compose up -d asterisk-a
docker compose logs -f asterisk-a
```

В другом окне:

```bash
docker compose exec asterisk-a asterisk -rx "core show version"
docker compose exec asterisk-a asterisk -rx "pjsip show endpoints" | head
```

### Шаг 6.3 — мониторинг + Web UI

```bash
docker compose up -d prometheus grafana webui fail2ban
docker compose ps
```

---

## 7. Firewall (если ufw включён)

```bash
sudo ufw allow 22/tcp
sudo ufw allow 21/tcp      # FTP (vsftpd), лучше только из офисной сети
sudo ufw allow 40000:40100/tcp   # FTP passive (FileZilla)
sudo ufw allow 9000/tcp    # Web UI
sudo ufw allow 5060/udp    # SIP (если нужен с других хостов)
sudo ufw allow 5061/tcp    # SIP TLS
sudo ufw allow 8089/tcp    # WSS
sudo ufw allow 10000:20000/udp   # RTP — диапазон из rtp.conf
sudo ufw allow 3001/tcp    # Grafana (только из офисной сети!)
sudo ufw allow 9091/tcp    # Prometheus (только из офисной сети!)
```

---

## 7b. FTP / SFTP (FileZilla)

**SFTP** уже работает через SSH (порт **22**). В FileZilla выберите протокол **SFTP**, не FTP.

**FTP** (порт 21) на сервере по умолчанию не установлен — отсюда `ECONNREFUSED`. Установка:

```bash
cd /opt/call-center/asterisk-cc-phase1
sudo PASV_ADDRESS=172.16.6.183 bash scripts/setup-ftp-sftp.sh
```

Подробно: [ops/ftp-sftp-filezilla.md](ftp-sftp-filezilla.md).

---

## 8. Где открыть интерфейсы

| URL | Логин |
|-----|--------|
| http://172.16.6.183:9000/ | `admin` / `admin` или `agent01` / `agent01` |
| http://172.16.6.183:3001/ | Grafana: `admin` + пароль из `GRAFANA_ADMIN_PASSWORD` |
| http://172.16.6.183:9091/ | Prometheus (без auth по умолчанию) |

Web UI — **демо** без REST API; Asterisk — боевой контейнер, но операторы могут работать в «Демо-режим» до настройки WSS.

---

## 9. Smoke-проверка

```bash
# SQL
docker compose exec -T postgres psql -U postgres -d asterisk_cc -f - < tests/smoke.sql

# Записи / CDR — после тестового звонка
docker compose exec asterisk-a ls -la /var/spool/asterisk/recordings | head
```

Чек-лист: `tests/acceptance_tests.md`

---

## 10. Что дальше (prod)

1. **Phase 1.5** — REST API между Web UI и Postgres/AMI.
2. **NAS** — вынести `recordings` на NFS volume.
3. **Kamailio** — `docker compose --profile sbc up -d kamailio`.
4. **HA** — второй Asterisk: `docker compose --profile ha up -d asterisk-b` + keepalived на VM.
5. Сменить все demo-пароли в `webui/data/users.json` и `pjsip.conf`.

---

## Конфликты портов с SMSC

| Если занят | Что сделать |
|------------|-------------|
| **5432** | Оставить в `docker-compose.yml` проброс **5433:5432**, в `.env` `PG_PORT=5433` |
| **3000** | Grafana уже на **3001** |
| **9090** | Prometheus уже на **9091** |
| **5060/8089** | Конфликт с другим SIP — менять `pjsip.conf` / `http.conf` или вынести КЦ на отдельную VM |
| **9000** | В `docker-compose.yml` у `webui` → `"9001:9000"` |

После правок: `docker compose up -d`

---

## Troubleshooting: пустая БД

Postgres init иногда не применяет все `.sql`. Вручную:

```bash
cd /opt/call-center/asterisk-cc-phase1
for f in postgres/sql/*.sql; do
  echo "=== $f ==="
  docker compose exec -T postgres psql -U postgres -d asterisk_cc -f - < "$f" || true
done
```

Пароли ролей в `00_extensions.sql` по умолчанию `changeme` — должны совпадать с `PG_PASSWORD` в `.env` или поправить SQL и пересоздать volume:

```bash
docker compose down
docker volume rm asterisk-cc-phase1_pgdata   # удалит данные!
docker compose up -d postgres
```

---

## Troubleshooting: TLS handshake timeout при docker pull

Сеть до Docker Hub нестабильна. Не тяните все образы сразу.

```bash
cd /opt/call-center/asterisk-cc-phase1
dos2unix scripts/docker-pull-retry.sh 2>/dev/null
bash scripts/docker-pull-retry.sh
```

Или по одному вручную:

```bash
docker pull postgres:16
docker pull python:3.10-slim
docker pull grafana/grafana:latest
docker pull prom/prometheus:latest
docker pull crazymax/fail2ban:latest
```

**Минимальный lab** (если Grafana/Prometheus не качаются):

```bash
docker compose up -d postgres asterisk-a webui
docker compose ps
```

Grafana и Prometheus можно добавить позже:

```bash
docker compose up -d grafana prometheus fail2ban
```

Ускорение (опционально, `/etc/docker/daemon.json` + `sudo systemctl restart docker`):

```json
{
  "max-concurrent-downloads": 2,
  "max-download-attempts": 5
}
```

---

## SSH обрывается после работы с Asterisk / SIP

Если сессия `ssh sorbon@172.16.6.183` внезапно рвётся, чаще всего IP попал в **fail2ban** (jail `asterisk`): в старой конфигурации использовался `iptables-allports` и блокировался **весь** трафик, включая SSH.

На сервере:

```bash
sudo fail2ban-client status asterisk
sudo fail2ban-client status asterisk-pjsip
sudo iptables -L f2b-asterisk -n 2>/dev/null; sudo iptables -L -n | grep -i f2b | head -20
# разбанить свой IP (подставьте IP вашего ПК/VPN):
sudo fail2ban-client set asterisk unbanip <ВАШ_IP>
sudo fail2ban-client set asterisk-pjsip unbanip <ВАШ_IP>
```

После обновления `monitoring/fail2ban/jail.local` (только SIP-порты + `ignoreip`):

```bash
cd /opt/call-center/asterisk-cc-phase1
docker compose restart fail2ban
```

---

## Безопасность

- Не храните пароль SSH в `.env` и не коммитьте `.env` в git.
- Пароли из чата (`qwerty123`) — **сменить** на сервере и в `.env`.
- Grafana/Prometheus не выставлять в интернет без auth/VPN.
