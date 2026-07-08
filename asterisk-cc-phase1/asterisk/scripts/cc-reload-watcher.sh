#!/bin/bash
# Watch .reload_requested and apply Asterisk reloads (Web UI / cc_config_sync).
set -euo pipefail

AST_BIN="/usr/sbin/asterisk"
[[ -x "${AST_BIN}" ]] || AST_BIN="/usr/sbin/asterisk-bin"

while true; do
  if [[ -f /etc/asterisk/.reload_requested ]]; then
    echo "cc-reload-watcher: applying reload" >&2
    "${AST_BIN}" -rx "dialplan reload" 2>/dev/null || true
    "${AST_BIN}" -rx "queue reload all" 2>/dev/null || true
    "${AST_BIN}" -rx "module reload res_pjsip.so" 2>/dev/null || true
    "${AST_BIN}" -rx "http reload" 2>/dev/null || true
    rm -f /etc/asterisk/.reload_requested
  fi
  sleep 2
done
