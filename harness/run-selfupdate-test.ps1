# 3SM 0.3.9.0 -> 0.3.9.1 self-update-test (test-artifact 0.3.9.1, NIET publiceren).
# Bewijst dat een geïnstalleerde 0.3.9.0 de NIEUWE 10-arg updater kan gebruiken voor een
# toekomstige testversie 0.3.9.1: download->verify->stage->10-arg launch->install->SUCCESS.
$ErrorActionPreference = "Stop"
$updater = "C:\Users\vdevo\3sm\simhub-plugin\3SM.EnduranceConnector.Updater\bin\Release\3SM.EnduranceConnector.Updater.exe"
$dummy   = "C:\Users\vdevo\3sm\harness\simhub\SimHubWPF.exe"
$base391 = "C:\Users\vdevo\3sm\harness\selfupdate"
$csc = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe"
$refBase = "C:\Program Files (x86)\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8"
$simhub = "C:\Program Files (x86)\SimHub"
$connSrc = "C:\Users\vdevo\3sm\simhub-plugin\3SM.EnduranceConnector"
function Sha256($p){ (Get-FileHash -Algorithm SHA256 -Path $p).Hash.ToLowerInvariant() }
function Get-Ver($p){ [System.Diagnostics.FileVersionInfo]::GetVersionInfo($p).FileVersion }

# --- Stap 1: bouw 0.3.9.1 TEST-DLL (RSA_TEST_KEY+AssemblyVersion 0.3.9.1) naar aparte dir ---
New-Item -ItemType Directory -Force "$base391" | Out-Null
$asmInfo391 = @'
using System.Reflection;
[assembly: AssemblyVersion("0.3.9.1")]
[assembly: AssemblyFileVersion("0.3.9.1")]
'@
Set-Content -Path "$base391\AssemblyInfo391.cs" -Value $asmInfo391 -Encoding UTF8
$srcs = @(
  (Join-Path $base391 "AssemblyInfo391.cs"),
  (Join-Path $connSrc "UpdaterStateStore.cs"),
  (Join-Path $connSrc "SessionTelemetryReader.cs"),
  (Join-Path $connSrc "ConnectorSettings.cs"),
  (Join-Path $connSrc "SettingsControl.cs"),
  (Join-Path $connSrc "TelemetryContracts.cs"),
  (Join-Path $connSrc "EnduranceConnectorPlugin.cs")
)
$v391 = "$base391\3SM.EnduranceConnector-0.3.9.1.dll"
$existing = & $csc /nologo /noconfig /nostdlib /target:library /define:RSA_TEST_KEY /define:TRACE /langversion:7.3 /optimize+ `
  /r:"$refBase\mscorlib.dll" /r:"$refBase\System.dll" /r:"$refBase\System.Core.dll" /r:"$refBase\System.Net.Http.dll" /r:"$refBase\System.Runtime.Serialization.dll" /r:"$refBase\System.Security.dll" /r:"$refBase\System.Xaml.dll" /r:"$refBase\System.Xml.dll" /r:"$refBase\WindowsBase.dll" /r:"$refBase\PresentationCore.dll" /r:"$refBase\PresentationFramework.dll" `
  /r:"$simhub\GameReaderCommon.dll" /r:"$simhub\log4net.dll" /r:"$simhub\SimHub.Logging.dll" /r:"$simhub\SimHub.Plugins.dll" `
  /out:"$v391" $srcs
if(!(Test-Path $v391)){ Write-Output "0391_BUILD_FAIL: $existing"; exit 1 }
Write-Output "0.3.9.1 test-DLL: ver=$(Get-Ver $v391) sha=$(Sha256 $v391)"

# --- Stap 2: deterministische 0.3.9.0->0.3.9.1 install ---
# target (installed) = 0.3.9.0, staged = 0.3.9.1
$d = "$base391\run"; if(Test-Path $d){Remove-Item $d -Recurse -Force}; New-Item -ItemType Directory -Force "$d\simhub"|Out-Null; New-Item -ItemType Directory -Force "$d\staged"|Out-Null
Copy-Item $dummy "$d\simhub\SimHubWPF.exe" -Force
Copy-Item "C:\Users\vdevo\3sm\simhub-plugin\3SM.EnduranceConnector\bin\Release\3SM.EnduranceConnector.dll" "$d\simhub\3SM.EnduranceConnector.dll" -Force  # target 0.3.9.0
Copy-Item $v391 "$d\staged\3SM.EnduranceConnector.dll" -Force  # staged 0.3.9.1
$exe = "$d\simhub\SimHubWPF.exe"; $target = "$d\simhub\3SM.EnduranceConnector.dll"; $staged = "$d\staged\3SM.EnduranceConnector.dll"

# dummy deterministisch
$started="Local\SU_STARTED"; $allow="Local\SU_ALLOW"
$hs=New-Object System.Threading.EventWaitHandle($false,[System.Threading.EventResetMode]::ManualReset,$started)
$ha=New-Object System.Threading.EventWaitHandle($false,[System.Threading.EventResetMode]::ManualReset,$allow)
$pf="$d\pid.txt"
$p=Start-Process $exe -ArgumentList " --pidfile `"$pf`" --started-event `"$started`" --allow-exit-event `"$allow`"" -PassThru
$hs.WaitOne(10000)|Out-Null
$l=Get-Content $pf; $simPid=[int]$l[0]; $ticks=[long]$l[1]
Write-Output "insight: installed-target ver Voor = $(Get-Ver $target)"

# 10-arg launch met ready-event: dit is het determinismesignaal. De updater set de
# ready-event NA AcquireSimHubProcess (PID/starttijd/pad identiteit) + SignalReady, vóór het
# wachten op SimHub-exit. De harness wacht op die ready-event VOORDAT de dummy sluit, zodat de
# PID-check gegarandeerd is afgerond (geen timing-race).
$rn="Local\3SM.EnduranceConnector.Updater.Ready."+([guid]::NewGuid().ToString("N"))
$devt=New-Object System.Threading.EventWaitHandle($false,[System.Threading.EventResetMode]::ManualReset,$rn)
$a="--pid $simPid --started-utc-ticks $ticks --target `"$target`" --staged `"$staged`" --sha256 $(Sha256($staged)) --installed-sha256 $(Sha256($target)) --length $((Get-Item $staged).Length) --version 0.3.9.1 --simhub `"$exe`" --ready-event `"$rn`" --no-restart"
# start updater, wacht op ready-event (bewijs PID-check gedaan), dan pas dummy sluiten
$u = Start-Process $updater -ArgumentList $a -PassThru
if(-not $devt.WaitOne(15000)){ Write-Output "NO_READY_EVENT (PID-identiteit niet bevestigd)"; try{$u.Kill()}catch{}; exit 2 }
Write-Output "ready-event ontvangen (PID-check OK); dummy kan nu sluiten"
$ha.Set(); $p.WaitForExit(15000)   # dummy exit -> updater ziet schone simhub-exit
$u.WaitForExit(30000)
$c=$u.ExitCode
$finalVer = Get-Ver $target
Write-Output "updater exit=$c  target ver NA = $finalVer"

$stf=Join-Path $env:LOCALAPPDATA "3SM\EnduranceConnector\Updater\updater-state.json"
$s = Get-Content $stf -Raw
Write-Output "state: $s"

$pass = ($c -eq 0) -and ($finalVer -eq "0.3.9.1") -and ($s -match '"state":"SUCCESS"')
if($pass){ Write-Output "`nSELFUPDATE_0390_TO_0391 PASS (10-arg self-update werkt, 0.3.9.1 staged geïnstalleerd, geen 6-arg-defect)" }
else { Write-Output "`nSELFUPDATE FAIL" }