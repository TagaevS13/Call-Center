#!/usr/bin/env bash
# Run Asterisk CLI command on native install.
set -euo pipefail
cmd="${*:-core show version}"
AST_BIN="/usr/sbin/asterisk"
[[ -x "${AST_BIN}" ]] || AST_BIN="/usr/sbin/asterisk-bin"
exec "${AST_BIN}" -rx "${cmd}"
