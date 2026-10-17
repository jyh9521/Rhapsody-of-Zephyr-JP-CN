param(
  [string]$ExePath = "zephyr.exe",
  [string]$TablePath = "_work\text\exe_strings_to_translate.tsv"
)

$ErrorActionPreference = "Stop"
$enc = [System.Text.Encoding]::GetEncoding(936)

$skipOffsets = New-Object 'System.Collections.Generic.HashSet[int]'
@(
  0x08e45c,0x08e464,0x08e46c,0x08e474,
  0x08e47c,0x08e488,0x08e494,0x08e4a0,
  0x08e4ac,0x08e4b4,0x08e4bc,0x08e4c4,
  0x08ef04,0x08ef10,0x08ef1c,0x08ef70,0x08ef98,0x08efd0,0x08f038,
  0x08f094,0x08f0f0,0x08f178,0x08f1b4,0x08f22c,
  0x08f6c8,0x08f6d4,0x08f6dc,0x08f6e8,0x08f6f4,
  0x0905ec,0x0905f6,0x090600,0x09060a,0x090cb0,
  0x09255c,0x0925c4
) | ForEach-Object { [void]$skipOffsets.Add([int]$_) }

function Convert-Escapes([string]$s) {
  return $s.Replace('\r\n', "`r`n").Replace('\n', "`n").Replace('\r', "`r").Replace('\t', "`t")
}

function Normalize-Cn([string]$s) {
  return (Convert-Escapes $s).Replace([char]0x30fb, [char]0x00b7)
}

$resolvedExe = Resolve-Path -LiteralPath $ExePath
$exe = [System.IO.File]::ReadAllBytes($resolvedExe)
$rows = Import-Csv -LiteralPath $TablePath -Delimiter "`t" -Encoding UTF8

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = "$ExePath.bak_before_exe_fixed_slots_$stamp"
Copy-Item -LiteralPath $ExePath -Destination $backup -Force

$applied = 0
$skippedKeys = 0
$blankRows = 0
$overflow = New-Object System.Collections.Generic.List[object]

foreach ($row in $rows) {
  $cn = [string]$row.cn_text
  if ([string]::IsNullOrWhiteSpace($cn)) {
    $blankRows++
    continue
  }
  $off = [Convert]::ToInt32(([string]$row.offset_hex), 16)
  if ($skipOffsets.Contains($off)) {
    $skippedKeys++
    continue
  }

  $cap = [int]$row.byte_capacity
  $text = Normalize-Cn $cn.Trim()
  $bytes = $enc.GetBytes($text)
  if ($bytes.Length -gt $cap) {
    $overflow.Add([pscustomobject]@{
      offset_hex = ("0x{0:x6}" -f $off)
      need_bytes = $bytes.Length
      cap_bytes = $cap
      cn_text = $text
    })
    continue
  }

  [Array]::Copy($bytes, 0, $exe, $off, $bytes.Length)
  for ($i = $off + $bytes.Length; $i -lt $off + $cap; $i++) {
    $exe[$i] = 0
  }
  $applied++
}

[System.IO.File]::WriteAllBytes($resolvedExe, $exe)
$overflowPath = "_work\text\exe_strings_overflow_fixed_slots.tsv"
$overflow | Export-Csv -LiteralPath $overflowPath -Delimiter "`t" -NoTypeInformation -Encoding UTF8

Write-Output ("backup: {0}" -f $backup)
Write-Output ("applied={0} skippedSpriteKeys={1} blankRows={2} overflowRows={3}" -f $applied, $skippedKeys, $blankRows, $overflow.Count)
if ($overflow.Count -gt 0) {
  Write-Output ("overflow rows written to {0}" -f $overflowPath)
}
