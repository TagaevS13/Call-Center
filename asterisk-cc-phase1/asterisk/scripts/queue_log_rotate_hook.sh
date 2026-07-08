#!/usr/bin/env bash
# Triggered by Asterisk logger.conf `exec_after_rotate` for queue_log.
# Forces immediate import of remaining lines into Postgres.
set -euo pipefail
exec /opt/cc/scripts/queue_log_import.py --once
