$ErrorActionPreference = 'Stop'
$hdxi = Get-ChildItem -Path 'D:\BM\billing' -Recurse -Filter 'CSP_V600R003C62_01_en_SEA01253.hdxi' |
    Select-Object -First 1
if (-not $hdxi) { throw 'hdxi not found' }
Write-Output ('PATH=' + $hdxi.FullName)
Write-Output ('LENGTH=' + $hdxi.Length)
$bytes = [System.IO.File]::ReadAllBytes($hdxi.FullName)
$n = [Math]::Min(64, $bytes.Length)
$hex = ($bytes[0..($n-1)] | ForEach-Object { $_.ToString('X2') }) -join ' '
Write-Output ('HEAD=' + $hex)
$text = [System.Text.Encoding]::ASCII.GetString($bytes[0..([Math]::Min(200,$bytes.Length-1))])
Write-Output ('ASCII_PREFIX=' + $text.Replace("`r",' ').Replace("`n",' | '))
