# 3SM updater crash-injectie / recovery (fix: unieke pidfiles, liveness-check per SimHub-run).
$ErrorActionPreference = "Stop"
$updater = "C:\Users\vdevo\3sm\simhub-plugin\3SM.EnduranceConnector.Updater\bin\Release\3SM.EnduranceConnector.Updater.exe"
$newDll  = "C:\Users\vdevo\3sm\simhub-plugin\3SM.EnduranceConnector\bin\Release\3SM.EnduranceConnector.dll"
$oldDll  = "C:\Users\vdevo\3sm\harness\assets\3SM.EnduranceConnector-0.3.8.0.dll"
function Sha256($p) { (Get-FileHash -Algorithm SHA256 -Path $p).Hash.ToLowerInvariant() }
function New-Dirs($name) { $d="C:\Users\vdevo\3sm\harness\runs\$name"; if(Test-Path $d){Remove-Item $d -Recurse -Force}; New-Item -ItemType Directory -Force "$d\simhub"|Out-Null; New-Item -ItemType Directory -Force "$d\staged"|Out-Null; return $d }
function Prep($d,$ms) { Copy-Item "C:\Users\vdevo\3sm\harness\simhub\SimHubWPF.exe" "$d\simhub\SimHubWPF.exe" -Force; Copy-Item $oldDll "$d\simhub\3SM.EnduranceConnector.dll" -Force; Copy-Item $newDll "$d\staged\3SM.EnduranceConnector.dll" -Force; return "$d\simhub\SimHubWPF.exe","$d\simhub\3SM.EnduranceConnector.dll","$d\staged\3SM.EnduranceConnector.dll" }
# Unieke pidfile per run (niet dezelfde voor crash- en recovery-run).
function StartSimHub($exe,$d,$tag,$ms) {
  $pf="$d\pid_$tag.txt"
  $a=" --pidfile `"$pf`""
  if($ms){$a+=" --exit-after $ms"}
  $p=Start-Process $exe -ArgumentList $a -PassThru
  for($i=0;$i -lt 50 -and -not (Test-Path $pf);$i++){Start-Sleep -Milliseconds 100}
  $l=Get-Content $pf
  return $p,[int]$l[0],[long]$l[1]
}
function BuildArgs($simPid,$ticks,$target,$staged,$exe,$extra) {
  $rn="Local\3SM.EnduranceConnector.Updater.Ready."+([guid]::NewGuid().ToString("N"))
  $evt=New-Object System.Threading.EventWaitHandle($false,[System.Threading.EventResetMode]::ManualReset,$rn)
  $script:readyHandles.Add($evt)|Out-Null
  return "--pid $simPid --started-utc-ticks $ticks --target `"$target`" --staged `"$staged`" --sha256 $(Sha256($staged)) --installed-sha256 $(Sha256($target)) --length $((Get-Item $staged).Length) --version 0.3.9.0 --simhub `"$exe`" --ready-event `"$rn`"" + $extra
}
function RunUpdater($a) { $p=Start-Process $updater -ArgumentList $a -PassThru -Wait; return $p.ExitCode }
function State { $f=Join-Path $env:LOCALAPPDATA "3SM\EnduranceConnector\Updater\updater-state.json"; if(-not(Test-Path $f)){return "MISSING"}; return (Get-Content $f -Raw) }
function IsRunning($p){try{return -not $p.HasExited}catch{return $false}}
$script:readyHandles = [System.Collections.ArrayList]::new()
Write-Output "updater: $([System.Diagnostics.FileVersionInfo]::GetVersionInfo($updater).FileVersion)"

$crashPoints = @("pre-replace","post-stage-pre-replace","post-replace-pre-reverify","post-reverify-pre-commit","post-commit")
$i=0
foreach ($cp in $crashPoints) {
  $i++
  Write-Output "`n=== CRASH[$i] @ $cp ==="
  $d=New-Dirs "crash_$cp"; $exe,$target,$staged = Prep $d 3000
  # CRASH-run: unieke pidfile 'c'
  $p,$simPid,$ticks = StartSimHub $exe $d "c" 3000
  $a = BuildArgs $simPid $ticks $target $staged $exe " --no-restart --simulate-crash $cp"
  $c = RunUpdater $a
  Write-Output "  crash-run exit=$c  targetIsOld=$((Sha256 $target) -eq (Sha256 $oldDll))  targetIsNew=$((Sha256 $target) -eq (Sha256 $newDll))"
  try { if(IsRunning $p){$p.Kill()} } catch {}
  Start-Sleep -Milliseconds 400
  # RECOVERY-run: herstel de staged (alsof de connector opnieuw een install-opportunity
  # aanbiedt; post-commit verwijdert de staged), unieke pidfile 'r', exit 3s.
  Copy-Item $newDll $staged -Force
  $p2,$simPid2,$ticks2 = StartSimHub $exe $d "r" 3000
  if(-not (IsRunning $p2)){
    Write-Output "  (dummy prematurely exited; herstart)"; try{$p2.Kill()}catch{}; $p2,$simPid2,$ticks2 = StartSimHub $exe $d "r2" 4000
  }
  $a2 = BuildArgs $simPid2 $ticks2 $target $staged $exe " --no-restart"
  $c2 = RunUpdater $a2
  $finalVer = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($target).FileVersion
  $s = State
  Write-Output "  recovery-run exit=$c2  finalver=$finalVer"
  Write-Output "  state=$s"
  $endedNew = ($finalVer -eq "0.3.9.0" -and $s -match '"state":"SUCCESS"')
  $endedOld = ($finalVer -eq "0.3.8.0")
  if ($endedNew -or $endedOld) { Write-Output "  CRASH[$i] $cp -> OK (eind=$finalVer, new+SUCCESS=$endedNew, old=$endedOld)" } else { Write-Output "  CRASH[$i] $cp -> FAIL (ambigue/anders)" }
  try { if(IsRunning $p){$p.Kill()} } catch {}
  try { if(IsRunning $p2){$p2.Kill()} } catch {}
}
Write-Output "`n=== DONE ==="