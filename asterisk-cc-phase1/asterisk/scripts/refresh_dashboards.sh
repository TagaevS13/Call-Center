#!/usr/bin/env bash
set -euo pipefail
psql "postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DB}" \
  -c "SELECT refresh_dashboards();"
