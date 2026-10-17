param(
  [string]$ExePath = "zephyr.exe"
)

$ErrorActionPreference = "Stop"

$seedScript = Join-Path $PSScriptRoot "make_exe_translation_seed.ps1"
$applyScript = Join-Path $PSScriptRoot "apply_exe_translations.ps1"

$seedCode = Get-Content -LiteralPath $seedScript -Raw -Encoding UTF8
Invoke-Expression $seedCode

& $applyScript -ExePath $ExePath
