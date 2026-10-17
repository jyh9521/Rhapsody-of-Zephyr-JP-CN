param(
  [string]$DecodedRoot = "_work\patched_decoded_story_final_cn_markers_gbk\_work\all_decoded",
  [string]$OutReport = "_work\text\short_bf_literal_fixes_report.json"
)

$ErrorActionPreference = "Stop"
$fixes = @(
  [pscustomobject]@{ label = "taichou_bang"; src_bf = "2edf2d083e76"; dst_bf = "09ec0c1b1c1e" },
  [pscustomobject]@{ label = "ike_bang"; src_bf = "324c3d103e76"; dst_bf = "f71a0ff61c1e" }
)

function Convert-HexToBytes([string]$hex) {
  $clean = $hex -replace '\s+', ''
  if (($clean.Length % 2) -ne 0) { throw "Odd hex length: $hex" }
  $out = New-Object byte[] ($clean.Length / 2)
  for ($i = 0; $i -lt $out.Length; $i++) {
    $out[$i] = [Convert]::ToByte($clean.Substring($i * 2, 2), 16)
  }
  return $out
}

function IndexOfBytes([byte[]]$data, [byte[]]$pattern, [int]$start) {
  if ($pattern.Length -eq 0 -or $data.Length -lt $pattern.Length) { return -1 }
  for ($i = $start; $i -le $data.Length - $pattern.Length; $i++) {
    $ok = $true
    for ($j = 0; $j -lt $pattern.Length; $j++) {
      if ($data[$i + $j] -ne $pattern[$j]) {
        $ok = $false
        break
      }
    }
    if ($ok) { return $i }
  }
  return -1
}

$files = Get-ChildItem -LiteralPath $DecodedRoot -File -Recurse
$changes = New-Object System.Collections.Generic.List[object]

foreach ($file in $files) {
  $data = [System.IO.File]::ReadAllBytes($file.FullName)
  $changed = $false

  foreach ($fix in $fixes) {
    $src = Convert-HexToBytes $fix.src_bf
    $dst = Convert-HexToBytes $fix.dst_bf
    if ($dst.Length -gt $src.Length) {
      throw "Fix '$($fix.label)' exceeds source byte length."
    }
    if ($dst.Length -lt $src.Length) {
      $padded = New-Object byte[] $src.Length
      [Array]::Copy($dst, $padded, $dst.Length)
      for ($k = $dst.Length; $k -lt $padded.Length; $k++) { $padded[$k] = 0xBF }
      $dst = $padded
    }

    $pos = 0
    while ($true) {
      $idx = IndexOfBytes $data $src $pos
      if ($idx -lt 0) { break }
      [Array]::Copy($dst, 0, $data, $idx, $dst.Length)
      $changed = $true
      $changes.Add([pscustomobject]@{
        file = $file.Name
        offset = ("0x{0:x}" -f $idx)
        label = $fix.label
      })
      $pos = $idx + $dst.Length
    }
  }

  if ($changed) {
    [System.IO.File]::WriteAllBytes($file.FullName, $data)
  }
}

$report = [pscustomobject]@{
  decodedRoot = $DecodedRoot
  changedCount = $changes.Count
  changes = $changes
}

$outDir = Split-Path -Parent $OutReport
if ($outDir) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $OutReport -Encoding UTF8
Write-Output ("changed={0} report={1}" -f $changes.Count, $OutReport)
