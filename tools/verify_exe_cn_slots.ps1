param(
  [string]$ExePath = "zephyr.exe",
  [string]$TablePath = "_work\text\exe_strings_to_translate.tsv",
  [string]$OutJson = "_work\text\exe_cn_slot_verify_report.json",
  [string]$OutTsv = "_work\text\exe_cn_slot_mismatches.tsv"
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

function Strip-NulTail([byte[]]$bytes) {
  $end = $bytes.Length
  while ($end -gt 0 -and $bytes[$end - 1] -eq 0) { $end-- }
  if ($end -eq $bytes.Length) { return $bytes }
  if ($end -eq 0) { return [byte[]]@() }
  return $bytes[0..($end - 1)]
}

$exe = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $ExePath))
$rows = Import-Csv -LiteralPath $TablePath -Delimiter "`t" -Encoding UTF8
$mismatches = New-Object System.Collections.Generic.List[object]
$checked = 0
$skippedKeys = 0
$blankRows = 0
$overflowRows = 0

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
  $expected = Normalize-Cn $cn.Trim()
  $expectedBytes = $enc.GetBytes($expected)
  if ($expectedBytes.Length -gt $cap) {
    $overflowRows++
    continue
  }

  $slot = New-Object byte[] $cap
  [Array]::Copy($exe, $off, $slot, 0, $cap)
  $actual = $enc.GetString((Strip-NulTail $slot))
  $checked++
  if ($actual -ne $expected) {
    $mismatches.Add([pscustomobject]@{
      offset_hex = ("0x{0:x6}" -f $off)
      category = $row.category
      jp_text = $row.jp_text
      expected = $expected
      actual = $actual
    })
  }
}

$report = [pscustomobject]@{
  checked = $checked
  mismatches = $mismatches.Count
  skippedSpriteKeys = $skippedKeys
  blankRows = $blankRows
  overflowRows = $overflowRows
  outTsv = $OutTsv
}

$outDir = Split-Path -Parent $OutJson
if ($outDir) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $OutJson -Encoding UTF8
$mismatches | Export-Csv -LiteralPath $OutTsv -Delimiter "`t" -NoTypeInformation -Encoding UTF8

Write-Output ("checked={0} mismatches={1} skippedSpriteKeys={2} overflowRows={3}" -f $checked, $mismatches.Count, $skippedKeys, $overflowRows)
