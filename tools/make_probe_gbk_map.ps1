$ErrorActionPreference = "Stop"

$patchPath = "_work\text\gbk_clean_probe_story_patch.json"
$outPath = "_work\text\probe_char_gbk_map.json"
$enc = [Text.Encoding]::GetEncoding(936)
$rows = Get-Content -LiteralPath $patchPath -Raw -Encoding UTF8 | ConvertFrom-Json

$seen = [ordered]@{}
foreach ($row in $rows) {
  $text = [string]$row.translation
  for ($i = 0; $i -lt $text.Length; $i++) {
    $ch = $text.Substring($i, 1)
    if ($ch -eq "/" -or $ch -eq "n" -or $ch -eq "[" -or $ch -eq "]") {
      continue
    }
    if (-not $seen.Contains($ch)) {
      $bytes = $enc.GetBytes($ch)
      if ($bytes.Length -eq 2) {
        $seen[$ch] = (($bytes | ForEach-Object { $_.ToString("X2") }) -join "")
      }
    }
  }
}

$items = foreach ($key in $seen.Keys) {
  [pscustomobject]@{
    char = $key
    gbk = $seen[$key]
    unicode = ([int][char]$key).ToString("X4")
  }
}

$json = $items | ConvertTo-Json -Depth 3
[IO.File]::WriteAllText((Join-Path (Get-Location) $outPath), $json, [Text.UTF8Encoding]::new($false))
Write-Host "wrote $($items.Count) chars -> $outPath"
