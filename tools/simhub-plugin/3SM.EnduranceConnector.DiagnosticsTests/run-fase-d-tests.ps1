$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$connector = Join-Path $root '3SM.EnduranceConnector'
$outDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'csc.exe voor .NET Framework ontbreekt' }
$exe = Join-Path $outDir '3SM.EnduranceConnector.DiagnosticsTests.exe'
& $csc /nologo /warn:4 /target:exe /out:$exe `
  /reference:System.dll `
  /reference:System.Core.dll `
  /reference:System.Net.Http.dll `
  /reference:System.Runtime.Serialization.dll `
  (Join-Path $connector 'DiagnosticsClient.cs') `
  (Join-Path $connector 'UpdaterStateStore.cs') `
  (Join-Path $connector 'SessionTelemetryReader.cs') `
  (Join-Path $connector 'ConnectorSettings.cs') `
  (Join-Path $PSScriptRoot 'FaseDTests.cs')
if ($LASTEXITCODE -ne 0) { throw "Fase D harness compile faalde: $LASTEXITCODE" }
& $exe
exit $LASTEXITCODE
