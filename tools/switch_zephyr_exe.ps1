param(
  [ValidateSet("old", "no_cd_v2", "no_cd_v3", "no_cd_v4", "no_cd_v4_textoutw_font", "polluted_no_cd_v2")]
  [string]$Version = "no_cd_v3"
)

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$targets = @{
  old = "zephyr.exe.old"
  no_cd_v2 = "zephyr.exe.bak_clean_no_cd_v2"
  no_cd_v3 = "zephyr.exe.bak_clean_no_cd_v3"
  no_cd_v4 = "zephyr.exe.bak_clean_no_cd_v4"
  no_cd_v4_textoutw_font = "zephyr.exe.bak_no_cd_v4_textoutw_font"
  polluted_no_cd_v2 = "zephyr.exe.bak_polluted_no_cd_v2"
}

$source = Join-Path $root $targets[$Version]
$dest = Join-Path $root "zephyr.exe"

if (!(Test-Path -LiteralPath $source)) {
  throw "Missing source executable: $source"
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $root "zephyr.exe.bak_before_switch_$stamp"
Copy-Item -LiteralPath $dest -Destination $backup -Force
Copy-Item -LiteralPath $source -Destination $dest -Force

Write-Output "Switched zephyr.exe to $Version"
Write-Output "Previous executable backed up as $backup"
