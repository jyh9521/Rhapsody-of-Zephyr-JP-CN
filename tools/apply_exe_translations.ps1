param(
  [string]$ExePath = "zephyr.exe",
  [string]$TablePath = "_work\text\exe_translations.json",
  [string]$BackupPath = "zephyr.exe.pre_cn"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $ExePath)) {
  throw "EXE not found: $ExePath"
}
if (!(Test-Path -LiteralPath $TablePath)) {
  throw "Translation table not found: $TablePath"
}
if (!(Test-Path -LiteralPath $BackupPath)) {
  Copy-Item -LiteralPath $ExePath -Destination $BackupPath
}

$enc = [Text.Encoding]::GetEncoding(
  932,
  [Text.EncoderFallback]::ExceptionFallback,
  [Text.DecoderFallback]::ExceptionFallback
)

$bytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $ExePath))
$rows = Get-Content -LiteralPath $TablePath -Raw -Encoding UTF8 | ConvertFrom-Json
$patched = 0

foreach ($row in $rows) {
  if ([string]::IsNullOrWhiteSpace($row.translation)) {
    continue
  }

  $offset = [int]$row.fileOffset
  $limit = [int]$row.byteLength
  $encoded = $enc.GetBytes([string]$row.translation)

  if ($encoded.Length -gt $limit) {
    throw "$($row.id) is too long: $($encoded.Length) bytes > $limit bytes: $($row.translation)"
  }

  [Array]::Clear($bytes, $offset, $limit)
  [Array]::Copy($encoded, 0, $bytes, $offset, $encoded.Length)
  $patched++
}

[IO.File]::WriteAllBytes((Resolve-Path -LiteralPath $ExePath), $bytes)
Write-Output "Patched $patched strings in $ExePath"
