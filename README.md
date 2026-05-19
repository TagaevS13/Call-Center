# Call Center (Asterisk)

Миграция кол-центра Babilon-Mobile с Huawei CSP/IPCC на Asterisk.

## Содержимое репозитория

| Каталог | Описание |
|---------|----------|
| [`asterisk-cc-phase1/`](asterisk-cc-phase1/) | Asterisk, PostgreSQL, Web UI, мониторинг, Docker Compose |
| [`docs/`](docs/) | ТЗ, функциональный обзор, HedEx README |

## Быстрый старт

```bash
cd asterisk-cc-phase1
cp .env.example .env
# см. asterisk-cc-phase1/README.md
```

Web UI (демо):

```bash
python asterisk-cc-phase1/webui/serve.py 9000
# http://localhost:9000/  — логин agent01/agent01, admin/admin
```

## Документация

- **Полное ТЗ v1.1:** [docs/TZ_Full_v1.1.md](docs/TZ_Full_v1.1.md)

## Важно

- Пароли в конфигах и `webui/data/users.json` — **только для демо/лаба**. Перед prod заменить.
- Не коммитить файл `.env` с реальными секретами.
