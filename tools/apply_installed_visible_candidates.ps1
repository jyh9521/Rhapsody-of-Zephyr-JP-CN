param(
  [string]$DecodedRoot = "_work\patched_decoded_story_final_cn_markers_gbk\_work\all_decoded",
  [string]$TablePath = "_work\text\installed_visible_japanese_candidates_to_translate.tsv",
  [string]$OutReport = "_work\text\installed_visible_candidates_apply_report.json",
  [string]$OutOverflow = "_work\text\installed_visible_candidates_overflow.tsv"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName Microsoft.VisualBasic
$sjis = [System.Text.Encoding]::GetEncoding(932)
$gbk = [System.Text.Encoding]::GetEncoding(936)

function Convert-ToBf([byte[]]$plain) {
  $out = New-Object byte[] $plain.Length
  for ($i = 0; $i -lt $plain.Length; $i++) {
    $out[$i] = (0xBF - $plain[$i]) -band 0xFF
  }
  return $out
}

function Normalize-Cn([string]$s) {
  return $s.Trim().Replace([char]0x30fb, [char]0x00b7)
}

function Read-QuotedTsv([string]$path) {
  $parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($path, [System.Text.Encoding]::UTF8)
  $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
  $parser.SetDelimiters("`t")
  $parser.HasFieldsEnclosedInQuotes = $true
  try {
    $header = $parser.ReadFields()
    $rows = New-Object System.Collections.Generic.List[object]
    $line = 1
    while (-not $parser.EndOfData) {
      $fields = $parser.ReadFields()
      $line++
      $row = [ordered]@{ __line = $line }
      for ($i = 0; $i -lt $header.Count; $i++) {
        $row[$header[$i]] = if ($i -lt $fields.Count) { $fields[$i] } else { "" }
      }
      $rows.Add([pscustomobject]$row)
    }
    return $rows
  } finally {
    $parser.Close()
  }
}

$rows = Read-QuotedTsv $TablePath
$applied = New-Object System.Collections.Generic.List[object]
$already = New-Object System.Collections.Generic.List[object]
$overflow = New-Object System.Collections.Generic.List[object]
$mismatch = New-Object System.Collections.Generic.List[object]
$missing = New-Object System.Collections.Generic.List[object]
$blank = 0

foreach ($row in $rows) {
  $cn = [string]$row.suggested_cn
  if ([string]::IsNullOrWhiteSpace($cn)) {
    $blank++
    continue
  }

  $file = [string]$row.file
  $target = Join-Path $DecodedRoot $file
  if (-not (Test-Path -LiteralPath $target)) {
    $missing.Add([pscustomobject]@{ line = $row.__line; file = $file; reason = "missing_target" })
    continue
  }

  $offset = [int]$row.offset
  $capacity = [int]$row.byteLength
  $jp = [string]$row.jp_text
  $cnNorm = Normalize-Cn $cn
  $cnBytes = $gbk.GetBytes($cnNorm)
  if ($cnBytes.Length -gt $capacity) {
    $overflow.Add([pscustomobject]@{
      line = $row.__line
      group_id = $row.group_id
      file = $file
      offset_hex = $row.offset_hex
      capacity = $capacity
      need_bytes = $cnBytes.Length
      jp_text = $jp
      suggested_cn = $cnNorm
    })
    continue
  }

  $data = [System.IO.File]::ReadAllBytes($target)
  if ($offset + $capacity -gt $data.Length) {
    $missing.Add([pscustomobject]@{ line = $row.__line; file = $file; reason = "range_out_of_file"; offset = $offset; capacity = $capacity })
    continue
  }

  $expected = Convert-ToBf ($sjis.GetBytes($jp))
  $actual = New-Object byte[] $expected.Length
  [Array]::Copy($data, $offset, $actual, 0, $expected.Length)
  $sourceMatches = $expected.Length -le $capacity
  if ($sourceMatches) {
    for ($i = 0; $i -lt $expected.Length; $i++) {
      if ($actual[$i] -ne $expected[$i]) {
        $sourceMatches = $false
        break
      }
    }
  }
  if (-not $sourceMatches) {
    $bfAlready = Convert-ToBf $cnBytes
    $targetMatches = $true
    for ($i = 0; $i -lt $capacity; $i++) {
      $expectedByte = if ($i -lt $bfAlready.Length) { $bfAlready[$i] } else { 0xBF }
      if ($data[$offset + $i] -ne $expectedByte) {
        $targetMatches = $false
        break
      }
    }
    if ($targetMatches) {
      $already.Add([pscustomobject]@{
        line = $row.__line
        group_id = $row.group_id
        file = $file
        offset_hex = $row.offset_hex
        capacity = $capacity
        bytes = $cnBytes.Length
        suggested_cn = $cnNorm
      })
      continue
    }

    $mismatch.Add([pscustomobject]@{
      line = $row.__line
      group_id = $row.group_id
      file = $file
      offset_hex = $row.offset_hex
      jp_text = $jp
      suggested_cn = $cnNorm
      reason = "source_bytes_not_current"
    })
    continue
  }

  $bf = Convert-ToBf $cnBytes
  [Array]::Copy($bf, 0, $data, $offset, $bf.Length)
  for ($i = $offset + $bf.Length; $i -lt $offset + $capacity; $i++) {
    $data[$i] = 0xBF
  }
  [System.IO.File]::WriteAllBytes($target, $data)

  $applied.Add([pscustomobject]@{
    line = $row.__line
    group_id = $row.group_id
    file = $file
    offset_hex = $row.offset_hex
    capacity = $capacity
    bytes = $cnBytes.Length
    jp_text = $jp
    suggested_cn = $cnNorm
  })
}

$outDir = Split-Path -Parent $OutReport
if ($outDir) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$overflow | Export-Csv -LiteralPath $OutOverflow -Delimiter "`t" -NoTypeInformation -Encoding UTF8
[pscustomobject]@{
  table = $TablePath
  decodedRoot = $DecodedRoot
  totalRows = $rows.Count
  blankSuggestedCn = $blank
  applied = $applied.Count
  alreadyApplied = $already.Count
  overflow = $overflow.Count
  sourceMismatch = $mismatch.Count
  missing = $missing.Count
  overflowTsv = $OutOverflow
  appliedSample = $applied | Select-Object -First 20
  alreadySample = $already | Select-Object -First 20
  overflowSample = $overflow | Select-Object -First 20
  mismatchSample = $mismatch | Select-Object -First 20
  missingSample = $missing | Select-Object -First 20
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutReport -Encoding UTF8

Write-Output ("applied={0} alreadyApplied={1} overflow={2} sourceMismatch={3} missing={4} blank={5}" -f $applied.Count, $already.Count, $overflow.Count, $mismatch.Count, $missing.Count, $blank)
Write-Output ("report={0}" -f $OutReport)
