$ErrorActionPreference = "Stop"
$base = "C:\Users\vdevo\3sm\harness"
New-Item -ItemType Directory -Force "$base\assets" | Out-Null
New-Item -ItemType Directory -Force "$base\simhub" | Out-Null
New-Item -ItemType Directory -Force "$base\runs" | Out-Null

# oude 0.3.8.0 DLL-asset: van de live download (lokaal al op /tmp/live_0380.dll) of kopie.
# We gebruiken de eerder gebouwde 0.3.8.0 als target. Controleer eerst of die bestaat op Beest.
$csc = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe"

function Choose-OldDll {
  $cands = @(
    "C:\Users\vdevo\3sm\harness\assets\3SM.EnduranceConnector-0.3.8.0.dll",
    "C:\Users\vdevo\Desktop\3-stripe-league-hub-main\builds\3sm-enduranceconnector\3SM.EnduranceConnector.dll"
  )
  foreach ($c in $cands) { if ((Test-Path $c) -and ([System.Diagnostics.FileVersionInfo]::GetVersionInfo($c).FileVersion -eq "0.3.8.0")) { return $c } }
  $o = Get-ChildItem "C:\Users\vdevo\3sm" -Recurse -Filter "3SM.EnduranceConnector.dll" -ErrorAction SilentlyContinue | Where-Object { [System.Diagnostics.FileVersionInfo]::GetVersionInfo($_.FullName).FileVersion -eq "0.3.8.0" } | Select-Object -First 1
  if ($o) { return $o.FullName }
  throw "FATAL: geen 0.3.8.0 target-DLL gevonden op Beest"
}

# 1. compileer dummy SimHubWPF
& $csc /nologo /out:"$base\simhub\SimHubWPF.exe" "$base\simhub\SimHubWPF.cs"
if ($LASTEXITCODE -ne 0) { Write-Output "DUMMY_COMPILE_FAIL"; exit 1 }
Write-Output "dummy compiled: $((Get-Item "$base\simhub\SimHubWPF.exe").Length) bytes"

# 2. oude 0.3.8.0 asset: de meegeleverde asset (0.3.8.0) heeft PRIORITEIT en wordt niet
# overschreven. Alleen als die ontbreekt zoeken we een andere bron.
$assetPath = "$base\assets\3SM.EnduranceConnector-0.3.8.0.dll"
if (Test-Path $assetPath) {
  $av = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($assetPath).FileVersion
  if ($av -eq "0.3.8.0") {
    Write-Output ("0.3.8.0 asset al aanwezig (ver " + $av + ") - behouden")
  } else {
    Write-Output "asset heeft verkeerde versie ($av) - overschrijf met bron"
    Copy-Item (Choose-OldDll) $assetPath -Force
  }
} else {
  Copy-Item (Choose-OldDll) $assetPath -Force
}
Write-Output ("0.3.8.0 asset ver: " + [System.Diagnostics.FileVersionInfo]::GetVersionInfo($assetPath).FileVersion)
Write-Output "SETUP_OK"