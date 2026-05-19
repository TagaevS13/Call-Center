#!/usr/bin/env bash
set -euo pipefail
psql -d asterisk_cc -c "SELECT retention_apply();"
