# Запуск: PowerShell ОТ ИМЕНИ АДМИНИСТРАТОРА (правый клик → Run as administrator)
# Разрешает входящий UDP с PBX 172.16.6.183 для WebRTC-голоса в браузере.

#Requires -RunAsAdministrator

$Pbx = "172.16.6.183"

$existing = Get-NetFirewallRule -DisplayName "CC-Asterisk-RTP-in" -ErrorAction SilentlyContinue
if ($existing) { Remove-NetFirewallRule -DisplayName "CC-Asterisk-RTP-in" }

New-NetFirewallRule `
  -DisplayName "CC-Asterisk-RTP-in" `
  -Direction Inbound `
  -Action Allow `
  -Protocol UDP `
  -RemoteAddress $Pbx `
  -Profile Any

$existing2 = Get-NetFirewallRule -DisplayName "CC-Asterisk-RTP-out" -ErrorAction SilentlyContinue
if ($existing2) { Remove-NetFirewallRule -DisplayName "CC-Asterisk-RTP-out" }

New-NetFirewallRule `
  -DisplayName "CC-Asterisk-RTP-out" `
  -Direction Outbound `
  -Action Allow `
  -Protocol UDP `
  -RemoteAddress $Pbx `
  -Profile Any

Write-Host "OK: firewall rules for UDP to/from $Pbx" -ForegroundColor Green
Get-NetFirewallRule -DisplayName "CC-Asterisk-RTP-*" | Format-Table DisplayName, Enabled, Direction
