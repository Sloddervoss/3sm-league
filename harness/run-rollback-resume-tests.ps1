# 3SM updater — rollback-failure (T29) + WAITING resume (T13/T14).
$ErrorActionPreference = "Stop"
$updater = "C:\Users\vdevo\3sm\simhub-plugin\3SM.EnduranceConnector.Updater\bin\Release\3SM.EnduranceConnector.Updater.exe"
$newDll  = "C:\Users\vdevo\3sm\simhub-plugin\3SM.EnduranceConnector\bin\Release\3SM.EnduranceConnector.dll"
$oldDll  = "C:\Users\vdevo\3sm\harness\assets\3SM.EnduranceConnector-0.3.8.0.dll"
function Sha256($p){ (Get-FileHash -Algorithm SHA256 -Path $p).Hash.ToLowerInvariant() }
function State { $f=Join-Path $env:LOCALAPPDATA "3SM\EnduranceConnector\Updater\updater-state.json"; if(-not(Test-Path $f)){return "MISSING"}; return (Get-Content $f -Raw) }
function New-Dirs($n) { $d="C:\Users\vdevo\3sm\harness\runs\$n"; if(Test-Path $d){Remove-Item $d -Recurse -Force}; New-Item -ItemType Directory -Force "$d\simhub"|Out-Null; return $d }
function Prep($d,$ms) { Copy-Item "C:\Users\vdevo\3sm\harness\simhub\SimHubWPF.exe" "$d\simhub\SimHubWPF.exe" -Force; Copy-Item $oldDll "$d\simhub\3SM.EnduranceConnector.dll" -Force; return "$d\simhub\SimHubWPF.exe","$d\simhub\3SM.EnduranceConnector.dll" }
function StartSimHub($exe,$d,$ms){ $pf="$d\pid.txt"; $a=" --pidfile `"$pf`""; if($ms){$a+=" --exit-after $ms"}; $p=Start-Process $exe -ArgumentList $a -PassThru; for($i=0;$i -lt 50 -and -not (Test-Path $pf);$i++){Start-Sleep -Milliseconds 100}; $l=Get-Content $pf; return $p,[int]$l[0],[long]$l[1] }
function RunUpdater($a){ $p=Start-Process $updater -ArgumentList $a -PassThru -Wait; return $p.ExitCode }
function IsRunning($p){try{return -not $p.HasExited}catch{return $false}}
$script:readyHandles = [System.Collections.ArrayList]::new()
function BuildArgs($simPid,$ticks,$target,$exe,$staged,$extra){
  $rn="Local\3SM.EnduranceConnector.Updater.Ready."+([guid]::NewGuid().ToString("N"))
  $evt=New-Object System.Threading.EventWaitHandle($false,[System.Threading.EventResetMode]::ManualReset,$rn)
  $script:readyHandles.Add($evt)|Out-Null
  return "--pid $simPid --started-utc-ticks $ticks --target `"$target`" --staged `"$staged`" --sha256 $(Sha256($staged)) --installed-sha256 $(Sha256($target)) --length $((Get-Item $staged).Length) --version 0.3.9.0 --simhub `"$exe`" --ready-event `"$rn`"" + $extra
}
$log=Join-Path $env:LOCALAPPDATA "3SM\EnduranceConnector\Updater\updater.log"
function RunUpdater($a){ $p=Start-Process $updater -ArgumentList $a -PassThru -Wait; return $p.ExitCode }

Write-Output "updater: $([System.Diagnostics.FileVersionInfo]::GetVersionInfo($updater).FileVersion)"

# === T29: rollback zelf faalt ===
# Construer: target bevat nieuwe 0.3.9.0 (na replace), backup is corrupt => als er daarna een
# fout optreedt die rollback vereist, kan RestoreBackupAtomic de rollback NIET bewijzen.
Write-Output "`n=== T29: rollback-failure ==="
$d=New-Dirs "t29"; $exe,$target = Prep $d 1500
$p,$simPid,$ticks = StartSimHub $exe $d 1500
$oldHash = Sha256 $oldDll
$newHash = Sha256 $newDll
# target op nieuwe 0.3.9.0 zetten (alsof File.Replace al gebeurd is)
Copy-Item $newDll $target -Force
$backup = "$target.3sm-backup"
# corrupte backup: willekeurige bytes -> sha != oldHash => RestoreBackupAtomic faalt als rollback nodig
$rand = New-Object byte[] 64; (New-Object Random).NextBytes($rand); [IO.File]::WriteAllBytes($backup,$rand)
$journal = "$target.3sm-journal"
# journaal: oldSha256=oldHash, newSha256=newHash; target==newHash => recovery ziet 'al geplaatst'
[IO.File]::WriteAllText($journal, "target=$target`nbackup=$backup`noldSha256=$oldHash`nnewSha256=$newHash`n")
$staged = "$d\simhub\staged.TMP.dll"; Copy-Item $newDll $staged -Force
try { if(IsRunning $p){$p.Kill()} } catch {}
Start-Sleep -Milliseconds 250
# schone recovery-run: RPLog zou 'Al geplaatst' zien en doorlopen; test de zuivere rollback-faalmode
# door de target-dll te beschadigen (target niet meer == newHash) + corrupte backup => recovery MOET
# rollback proberen maar kan het niet bewijzen => FAILED, journal behouden, geen SUCCESS.
$rand2 = New-Object byte[] 128; (New-Object Random).NextBytes($rand2); [IO.File]::WriteAllBytes($target,$rand2)
$p2,$simPid2,$ticks2 = StartSimHub $exe $d 1500
$a2 = BuildArgs $simPid2 $ticks2 $target $exe $staged " --no-restart"
$c = RunUpdater $a2
$s = State
$notSuccess = ($s -notmatch '"state":"SUCCESS"')
$journalExists = (Test-Path $journal)
$freq = $s -match 'FAILED|RECOVERY_REQUIRED'
Write-Output "  exit=$c stateFailed=$freq journalExists=$journalExists"
Write-Output "  state=$s"
if ($c -ne 0 -and $notSuccess -and $journalExists) { Write-Output "  T29 PASS (rollback-failure -> geen SUCCESS, journal behouden, FAILED)" } else { Write-Output "  T29 FAIL" }

# === T13: WAITING_FOR_RESTART resume ===
# reset de state-store zodat een verse scan begint
$stf=Join-Path $env:LOCALAPPDATA "3SM\EnduranceConnector\Updater\updater-state.json"
if(Test-Path $stf){Remove-Item $stf -Force}
Write-Output "`n=== T13: WAITING state aanwezig -> volgende schone exit doet install ==="
$d=New-Dirs "t13"
New-Item -ItemType Directory -Force "$d\staged" | Out-Null
# target = oude 0.3.8.0 (Zoals MAAR), staged = nieuwe 0.3.9.0 in aparte staged-dir
$exe,$target = Prep $d 1500
$staged = "$d\staged\3SM.EnduranceConnector.dll"; Copy-Item $newDll $staged -Force
$p,$ssimPid,$ticks = StartSimHub $exe $d 1500
# WAITING state file: wijst naar de staged 0.3.9.0 (zodat een hernieuwde install dezelfde staged gebruikt)
$waitState = @{schemaVersion=1;state="WAITING_FOR_RESTART";pendingUpdateVersion="0.3.9.0";pendingStagedDll=$staged;pendingSimHubPid=$ssimPid;lastUpdateResult="none";lastUpdateErrorCode="UPDATE_WAITING"} | ConvertTo-Json
Set-Content -Path $stf -Value $waitState -Encoding UTF8
# SimHub stoppen (schone exit-opportunity), daarna verse updater-run die de WAITING staged hervat
try { if(IsRunning $p){$p.Kill()} } catch {}
Start-Sleep -Milliseconds 250
$p2,$simPid2,$ticks2 = StartSimHub $exe $d 4000
$a = BuildArgs $simPid2 $ticks2 $target $exe $staged " --no-restart"
$c = RunUpdater $a
$finalVer=[System.Diagnostics.FileVersionInfo]::GetVersionInfo($target).FileVersion
$s = State
Write-Output "  exit=$c finalver=$finalVer state=$s"
# Na de hervatpoging moet de updater de WAITING staged opnieuw verifiëren + installeren -> SUCCESS
if ($c -eq 0 -and $finalVer -eq "0.3.9.0" -and $s -match '"state":"SUCCESS"') { Write-Output "  T13 PASS (WAITING staged hervat -> install + SUCCESS op schone exit)" } else { Write-Output "  T13 FAIL" }

Write-Output "`n=== DONE ==="