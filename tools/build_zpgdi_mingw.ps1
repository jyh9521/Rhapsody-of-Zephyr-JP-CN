$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$gccCandidates = @(
    "C:\msys64\mingw32\bin\gcc.exe",
    "C:\msys64\ucrt64\bin\gcc.exe"
)

$gcc = $null
foreach ($candidate in $gccCandidates) {
    if (Test-Path $candidate) {
        $gcc = $candidate
        break
    }
}

if (-not $gcc) {
    $cmd = Get-Command gcc -ErrorAction SilentlyContinue
    if ($cmd) {
        $gcc = $cmd.Source
    }
}

if (-not $gcc) {
    throw "No gcc found. Install MSYS2 and mingw-w64-i686-gcc first."
}

$gccBin = Split-Path -Parent $gcc
if ($env:PATH -notlike "*$gccBin*") {
    $env:PATH = "$gccBin;$env:PATH"
}

$out = Join-Path $root "ZPGDI.dll"
$src = Join-Path $PSScriptRoot "ZPGDI_proxy.c"
$def = Join-Path $PSScriptRoot "ZPGDI_proxy.def"
$nameGen = Join-Path $PSScriptRoot "make_zpgdi_builtin_names.py"

if (Test-Path $nameGen) {
    $pythonCandidates = @(
        (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"),
        "C:\Users\noway\AppData\Local\Python\pythoncore-3.14-64\python.exe"
    )

    $python = $null
    foreach ($candidate in $pythonCandidates) {
        if (Test-Path $candidate) {
            $python = $candidate
            break
        }
    }
    if (-not $python) {
        $cmd = Get-Command python -ErrorAction SilentlyContinue
        if ($cmd) {
            $python = $cmd.Source
        }
    }
    if (-not $python) {
        throw "No python found for make_zpgdi_builtin_names.py."
    }

    & $python $nameGen
    if ($LASTEXITCODE -ne 0) {
        throw "make_zpgdi_builtin_names.py failed with exit code $LASTEXITCODE"
    }
}

if (Test-Path $out) {
    $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
    Copy-Item $out "$out.bak_$stamp" -Force
}

& $gcc "-m32" "-shared" "-O2" "-s" "-Wall" "-Wextra" "-Wl,--kill-at" "-o" $out $src $def
if ($LASTEXITCODE -ne 0) {
    throw "gcc failed with exit code $LASTEXITCODE"
}

Remove-Item (Join-Path $root "zpgdi.log") -ErrorAction SilentlyContinue
Write-Host "Built $out"
