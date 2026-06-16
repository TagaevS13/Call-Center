# Upload and run fix-vsftpd-on-server.sh on project
param(
  [string]$HostAddr = "172.16.6.183",
  [string]$User = "sorbon"
)
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "fix-vsftpd-on-server.sh"
if (-not (Test-Path $script)) { throw "Missing $script" }

$pass = $env:CC_DEPLOY_PASS
if (-not $pass) {
  $sec = Read-Host "Password for ${User}@${HostAddr}" -AsSecureString
  $pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

$passEsc = $pass -replace "'", "\\'"
$scriptEsc = $script -replace '\\', '\\\\' -replace "'", "\\'"

$py = @"
import paramiko, sys
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('$HostAddr', username='$User', password='$passEsc', timeout=30)
sftp = c.open_sftp()
sftp.put(r'$scriptEsc', '/tmp/fix-vsftpd-on-server.sh')
sftp.close()
_, o, e = c.exec_command(
    'sed -i "s/\\r\$//" /tmp/fix-vsftpd-on-server.sh && '
    'sudo PASV_ADDRESS=172.16.6.183 bash /tmp/fix-vsftpd-on-server.sh',
    get_pty=True, timeout=120)
print(o.read().decode('utf-8', 'replace'))
err = e.read().decode('utf-8', 'replace')
if err:
    print(err, file=sys.stderr)
sys.exit(o.channel.recv_exit_status())
"@

python -c $py
