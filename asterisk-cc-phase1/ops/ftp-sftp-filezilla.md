# FTP и SFTP на сервере project (172.16.6.183)

## Почему FileZilla пишет ECONNREFUSED на порт 21

На сервере **не был запущен FTP-сервер** (vsftpd). Протокол **SFTP** — это не порт 21, а **SSH (порт 22)**.

---

## Быстрая установка (на сервере)

С Windows через `scp` скрипт часто получает **CRLF** → ошибка `set: pipefail: invalid option name`. Исправление:

```bash
sed -i 's/\r$//' /tmp/setup-ftp-sftp-standalone.sh
sudo PASV_ADDRESS=172.16.6.183 bash /tmp/setup-ftp-sftp-standalone.sh
```

Или из репозитория на сервере (после `git pull`):

```bash
cd /opt/call-center/asterisk-cc-phase1
sed -i 's/\r$//' scripts/setup-ftp-sftp-standalone.sh
sudo PASV_ADDRESS=172.16.6.183 bash scripts/setup-ftp-sftp-standalone.sh
```

Если репозиторий в другом месте — укажите свой путь. Для доступа по второму IP:

```bash
sudo PASV_ADDRESS=172.16.4.19 bash scripts/setup-ftp-sftp.sh
```

---

## FileZilla — SFTP (рекомендуется)

| Поле | Значение |
|------|----------|
| Протокол | **SFTP** — SSH File Transfer Protocol |
| Хост | `172.16.6.183` |
| Порт | **22** |
| Пользователь | `sorbon` |
| Пароль | как для SSH |

После входа: весь домашний каталог `/home/sorbon`, в т.ч. `/opt/call-center` если есть права.

---

## FileZilla — FTP (порт 21)

| Поле | Значение |
|------|----------|
| Протокол | **FTP** — File Transfer Protocol |
| Хост | `172.16.6.183` |
| Порт | **21** |
| Пользователь | `sorbon` |
| Пароль | как для SSH |
| Режим | **Пассивный (Passive)** — в настройках передачи FileZilla |

Корень FTP: `/home/sorbon/ftp` (загрузки в `upload/`).  
В `vsftpd.conf` обязательно: `user_sub_token=$USER` и `local_root=/home/$USER/ftp` (иначе ошибка `cannot change directory:/home/$USER/ftp`).  
`use_localtime=NO` — время в FileZilla совпадает с `ls` при поясе `Asia/Dushanbe`.  
Папка `recordings/` в FTP — bind-mount на `.../asterisk-cc-phase1/recordings`.

Пассивные порты на сервере: **40000–40100** (если включите ufw — открыть их с офисной сети).

---

## Проверка на сервере

```bash
sudo ss -tlnp | grep -E ':21|:22'
sudo systemctl status vsftpd ssh --no-pager
```

---

## Безопасность

- FTP передаёт пароль **открытым текстом** — в проде лучше только **SFTP** или FTPS.
- vsftpd разрешён только пользователям из `/etc/vsftpd.userlist` (по умолчанию `sorbon`).
- Не открывайте FTP в интернет без VPN.
