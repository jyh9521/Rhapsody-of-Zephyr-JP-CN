Copy-Item -LiteralPath "zephyr.exe.bak_before_gbk_probe" -Destination "zephyr.exe" -Force
Copy-Item -LiteralPath "ZEP_DAT2.HDR.bak_before_gbk_probe" -Destination "ZEP_DAT2.HDR" -Force
Copy-Item -LiteralPath "ZEP_DAT2.LIB.bak_before_gbk_probe" -Destination "ZEP_DAT2.LIB" -Force
if (Test-Path -LiteralPath "dgVoodoo.conf.bak_before_sprite_test") {
  Copy-Item -LiteralPath "dgVoodoo.conf.bak_before_sprite_test" -Destination "dgVoodoo.conf" -Force
}
Write-Host "Restored zephyr.exe, ZEP_DAT2.HDR/LIB, and dgVoodoo.conf from probe backups."
