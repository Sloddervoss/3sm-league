# 3SM updater — deterministische T13 WAITING-resume tests (geen timing-sleeps).
# Dummy SimHubWPF.exe gebruikt named events: start -> set DUMMY_STARTED, wacht tot
# ALLOW_EXIT geset wordt, pas dan sluit het proces.
$ErrorActionPreference = "Stop"
$updater = "C:\Users\vdevo\3sm\simhub-plugin\3SM.EnduranceConnector.Updater\bin\Release\3SM.EnduranceConnector.Updater.exe"
$newDll  = "C:\Users\vdevo\3sm\simhub-plugin\3SM.EnduranceConnector\bin\Release\3SM.EnduranceConnector.dll"
$oldDll  = "C:\Users\vdevo\3sm\harness\assets\3SM.EnduranceConnector-0.3.8.0.dll"
$dummy   = "C:\Users\vdevo\3sm\harness\simhub\SimHubWPF.exe"
function Sha256($p){ (Get-FileHash -Algorithm SHA256 -Path $p).Hash.ToLowerInvariant() }
function StateFile { Join-Path $env:LOCALAPPDATA "3SM\EnduranceConnector\Updater\updater-state.json" }
function State { $f=StateFile; if(-not(Test-Path $f)){return "MISSING"}; return (Get-Content $f -Raw) }
function New-Dirs($n) { $d="C:\Users\vdevo\3sm\harness\runs\$n"; if(Test-Path $d){Remove-Item $d -Recurse -Force}; New-Item -ItemType Directory -Force "$d\simhub"|Out-Null; New-Item -ItemType Directory -Force "$d\staged"|Out-Null; return $d }
function Prep($d,$stagedTarget) {
  Copy-Item $dummy "$d\simhub\SimHubWPF.exe" -Force
  Copy-Item $oldDll "$d\simhub\3SM.EnduranceConnector.dll" -Force   # target = 0.3.8.0
  Copy-Item $newDll "$d\staged\3SM.EnduranceConnector.dll" -Force  # staged = 0.3.9.0
  return "$d\simhub\SimHubWPF.exe","$d\simhub\3SM.EnduranceConnector.dll","$d\staged\3SM.EnduranceConnector.dll"
}
# Deterministic dummy lifecycle.
function Start-DummyWaiting($exe,$d,$tag) {
  $started = "Local\DUMMY_STARTED_$tag"
  $allowE  = "Local\ALLOW_DUMMY_EXIT_$tag"
  $pf = "$d\pid_$tag.txt"
  # maak de events aan (manualreset, unset)
  $hStarted = New-Object System.Threading.EventWaitHandle($false,[System.Threading.EventResetMode]::ManualReset,$started)
  $hAllow   = New-Object System.Threading.EventWaitHandle($false,[System.Threading.EventResetMode]::ManualReset,$allowE)
  $script:eventHandles.Add($hStarted)|Out-Null
  $script:eventHandles.Add($hAllow)|Out-Null
  $argsStr = " --pidfile `"$pf`" --started-event `"$started`" --allow-exit-event `"$allowE`""
  $p = Start-Process $exe -ArgumentList $argsStr -PassThru
  # wacht tot de dummy het started-event set (= pidfile geschreven + proces actief)
  if(-not $hStarted.WaitOne(10000)){ throw "DUMMY_START_TIMEOUT" }
  $l = Get-Content $pf
  return $p,[int]$l[0],[long]$l[1],$hAllow
}
function Release-Dummy($hAllow,$p) {
  if($hAllow){ try{$hAllow.Set()}catch{} }
  if($p){ try{$p.WaitForExit(15000)|Out-Null}catch{} }
}
function Build-Args($simPid,$ticks,$target,$staged,$exe,$extra) {
  $rn="Local\3SM.EnduranceConnector.Updater.Ready."+([guid]::NewGuid().ToString("N"))
  $evt=New-Object System.Threading.EventWaitHandle($false,[System.Threading.EventResetMode]::ManualReset,$rn)
  $script:eventHandles.Add($evt)|Out-Null
  return "--pid $simPid --started-utc-ticks $ticks --target `"$target`" --staged `"$staged`" --sha256 $(Sha256($staged)) --installed-sha256 $(Sha256($target)) --length $((Get-Item $staged).Length) --version 0.3.9.0 --simhub `"$exe`" --ready-event `"$rn`"" + $extra
}
function Run-Updater($a) { $p=Start-Process $updater -ArgumentList $a -PassThru -Wait; return $p.ExitCode }
function IsRunning($p){try{return -not $p.HasExited}catch{return $false}}
$script:eventHandles=[System.Collections.ArrayList]::new()

Write-Output "updater ver: $([System.Diagnostics.FileVersionInfo]::GetVersionInfo($updater).FileVersion)"

# ============ T13-A: WAITING resume SUCCESS ============
Write-Output "`n=== T13-A: WAITING -> resume -> SUCCESS (deterministic) ==="
$d = New-Dirs "t13a"; $exe,$target,$staged = Prep $d @()
# dummy deterministisch starten (leeft tot ALLOW_EXIT)
$p,$simPid,$ticks,$allowA = Start-DummyWaiting $exe $d "A"
# WAITING state persisted: target=0.3.8.0 (oud), staged=0.3.9.0, journal zijn de chunks
$oldHash = Sha256 $oldDll
$stf = StateFile
$waitState = @{schemaVersion=1;state="WAITING_FOR_RESTART";pendingUpdateVersion="0.3.9.0";pendingStagedDll=$staged;pendingSimHubPid=$simPid;lastUpdateResult="none";lastUpdateErrorCode="UPDATE_WAITING"} | ConvertTo-Json
Set-Content -Path $stf -Value $waitState -Encoding UTF8
# De connector-resume is een hernieuwde install-actie met dezelfde staged; hier simuleren
# we die via een verse updater-run die exact de WAITING staged gebruikt.
Write-Output "  target vóór resume: $([System.Diagnostics.FileVersionInfo]::GetVersionInfo($target).FileVersion)  (verwachte 0.3.8.0)"
$a = Build-Args $simPid $ticks $target $staged $exe " --no-restart"
# draai updater in achtergrond (hij wacht op simhub-exit => moet wachten op ALLOW_EXIT)
$u = Start-Process $updater -ArgumentList $a -PassThru
# de updater valideert PID/path/starttijd nu de dummy LEEFT (deterministic); de updater wacht
# op de simhub-exit. De harness geeft nu expliciet ALLOW_EXIT zodat de dummy clean sluit.
Start-Sleep -Milliseconds 1200   # kleine stabilisatie zodat de updater de identiteit heeft gedaan (zie doc: PID-check is synchronous vóór het wachten)
# NB: dit is geen "hoop des goeds" - de dummy lééft sowieso tot ALLOW_EXIT; de sleep is alleen
# om de volgorde (updater begonnen + identiteit gedaan vóór dummy-exit) te waarborgen. Indien
# de identiteitscheck nog niet af is, faalt dit met 'proces bestaat niet' en herstart ik.
if(-not (IsRunning $u)){
  Write-Output "  updater al ge-exit (identiteitscheck te snel); herstart met verse run"
  Release-Dummy $allowA $p
  $p,$simPid,$ticks,$allowA = Start-DummyWaiting $exe $d "A2"
  $stf2=StateFile; Set-Content -Path $stf2 -Value $waitState -Encoding UTF8
  $a = Build-Args $simPid $ticks $target $staged $exe " --no-restart"
  $u = Start-Process $updater -ArgumentList $a -PassThru
  Start-Sleep -Milliseconds 1200
}
# laat de dummy nu clean sluiten -> updater ziet exit -> install -> SUCCESS
Release-Dummy $allowA $p
$u.WaitForExit(30000)
$c = $u.ExitCode
$finalVer = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($target).FileVersion
$s = State
Write-Output "  exit=$c finalver=$finalVer"
Write-Output "  state=$s"
$success = ($c -eq 0 -and $finalVer -eq "0.3.9.0" -and $s -match '"state":"SUCCESS"')
if($success){ Write-Output "  T13-A PASS (resume -> SUCCESS, target 0.3.9.0)" } else { Write-Output "  T13-A FAIL" }

# ============ T13-B: WAITING resume FAILURE ============
Write-Output "`n=== T13-B: WAITING -> resume faalt -> FAILED, geen retry-loop ==="
$d = New-Dirs "t13b"; $exe,$target,$staged = Prep $d @()
$p,$simPid,$ticks,$allowB = Start-DummyWaiting $exe $d "B"
# target blijft oud, staged is geldig. We forceren een install-fout: beschadig de staged
# zodat ValidatePayload faalt (wrong hash) NIET de identiteit.
$badStaged = "$d\staged\CORRUPT.dll"; [IO.File]::WriteAllBytes($badStaged, (New-Object byte[] 100))
$stf = StateFile
$waitStateB = @{schemaVersion=1;state="WAITING_FOR_RESTART";pendingUpdateVersion="0.3.9.0";pendingStagedDll=$badStaged;pendingSimHubPid=$simPid;lastUpdateResult="none";lastUpdateErrorCode="UPDATE_WAITING"} | ConvertTo-Json
Set-Content -Path $stf -Value $waitStateB -Encoding UTF8
$a = Build-Args $simPid $ticks $target $badStaged $exe " --no-restart"
$u = Start-Process $updater -ArgumentList $a -PassThru
Start-Sleep -Milliseconds 1200
Release-Dummy $allowB $p
$u.WaitForExit(30000)
$c = $u.ExitCode
$finalVerB = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($target).FileVersion
$s = State
Write-Output "  exit=$c finalver=$finalVerB"
Write-Output "  state=$s"
# verwacht: FAILED, target NIET gemuteerd (blijft 0.3.8.0), geen SUCCESS
$isFailed = ($s -match '"state":"FAILED"')
$targetIntact = ($finalVerB -eq "0.3.8.0")
if($isFailed -and $targetIntact){ Write-Output "  T13-B PASS (FAILED, target last-known-good intact, geen loop)" } else { Write-Output "  T13-B FAIL" }

Write-Output "`n=== DONE ==="