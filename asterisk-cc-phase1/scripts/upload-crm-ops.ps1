# Upload CRM + ops API to server (run from repo root on Windows)
# Usage: .\scripts\upload-crm-ops.ps1
# Requires: scp/ssh to sorbon@172.16.6.183

$RemoteHost = "172.16.6.183"
$User = "sorbon"
$Remote = "/opt/call-center/asterisk-cc-phase1"
$Root = Split-Path $PSScriptRoot -Parent

$files = @(
    "postgres/sql/22_crm_connectors.sql",
    "webui/crm_api.py",
    "webui/crm_engine.py",
    "webui/ops_api.py",
    "webui/cc_api.py",
    "webui/seed_admin.py",
    "webui/requirements.txt",
    "webui/data/crm_connectors.json",
    "webui/shared/auth.js",
    "webui/admin/admin.js",
    "webui/admin/index.html",
    "webui/agent/agent.js",
    "webui/agent/index.html",
    "webui/supervisor/supervisor.js",
    "webui/supervisor/index.html"
)

Write-Host "Upload to ${User}@${RemoteHost}:${Remote}"
foreach ($rel in $files) {
    $local = Join-Path $Root $rel
    if (-not (Test-Path $local)) {
        Write-Warning "Skip missing: $rel"
        continue
    }
    $dir = Split-Path $rel -Parent
    ssh "${User}@${RemoteHost}" "mkdir -p ${Remote}/$($dir -replace '\\','/')"
    scp $local "${User}@${RemoteHost}:${Remote}/$($rel -replace '\\','/')"
    Write-Host "  OK $rel"
}

Write-Host "`nOn server run:"
Write-Host "  cd $Remote/webui"
Write-Host "  pip install -q -r requirements.txt"
Write-Host "  python seed_admin.py data"
Write-Host "  sudo systemctl restart cc-webui"
Write-Host "  curl -s http://127.0.0.1:9000/api/admin/crm-connectors"
