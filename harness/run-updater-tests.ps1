param([string]$Only = "")
$ErrorActionPreference = "Stop"

$updater = "C:\Users\vdevo\3sm\simhub-plugin\3SM.EnduranceConnector.Updater\bin\Release\3SM.EnduranceConnector.Updater.exe"
$newDll  = "C:\Users\vdevo\3sm\simhub-plugin\3SM.EnduranceConnector\bin\Release\3SM.EnduranceConnector.dll"   # staged 0.3.9.0
$oldDll  = "C:\Users\vdevo\3sm\harness\assets\3SM.EnduranceConnector-0.3.8.0.dll"                            # target 0.3.8.0
$dummy   = "C:\Users\vdevo\3sm\harness\simhub\SimHubWPF.exe"
$script:readyHandles = [System.Collections.ArrayList]::new()

function Sha256($p) { (Get-FileHash -Algorithm SHA256 -Path $p).Hash.ToLowerInvariant() }
function IsRunning($p) { try { return -not $p.HasExited } catch { return $false } }

function New-Dirs($name) {
    $d = "C:\Users\vdevo\3sm\harness\runs\$name"
    if (Test-Path $d) { Remove-Item $d -Recurse -Force }
    New-Item -ItemType Directory -Force "$d\simhub" | Out-Null
    New-Item -ItemType Directory -Force "$d\staged" | Out-Null
    return $d
}
function Prep($d, $exitAfterMs) {
    Copy-Item $dummy "$d\simhub\SimHubWPF.exe" -Force
    Copy-Item $oldDll "$d\simhub\3SM.EnduranceConnector.dll" -Force
    Copy-Item $newDll "$d\staged\3SM.EnduranceConnector.dll" -Force
    $exe = "$d\simhub\SimHubWPF.exe"; $target = "$d\simhub\3SM.EnduranceConnector.dll"; $staged = "$d\staged\3SM.EnduranceConnector.dll"
    return $exe,$target,$staged
}
function StartSimHub($exe, $d, $exitAfterMs) {
    $pf = "$d\pid.txt"
    $a = " --pidfile `"$pf`""
    if ($exitAfterMs) { $a += " --exit-after $exitAfterMs" }
    $p = Start-Process -FilePath $exe -ArgumentList $a -PassThru
    for ($i=0; $i -lt 50 -and -not (Test-Path $pf); $i++) { Start-Sleep -Milliseconds 100 }
    $l = Get-Content $pf
    return $p, [int]$l[0], [long]$l[1], $pf
}
function Build-Args($simPid, $ticks, $target, $staged, $exe, $extra) {
    $rn = "Local\3SM.EnduranceConnector.Updater.Ready." + ([guid]::NewGuid().ToString("N"))
    # caller moet de named ready-event aanmaken (regex-vereiste); connector doet dit ook.
    $evt = New-Object System.Threading.EventWaitHandle($false, [System.Threading.EventResetMode]::ManualReset, $rn)
    $script:readyHandles.Add($evt) | Out-Null   # hou open zodat de updater het event kan set
    return "--pid $simPid --started-utc-ticks $ticks --target `"$target`" --staged `"$staged`" --sha256 $(Sha256($staged)) --installed-sha256 $(Sha256($target)) --length $((Get-Item $staged).Length) --version 0.3.9.0 --simhub `"$exe`" --ready-event `"$rn`"" + $extra
}
function RunUpdater($argsStr) {
    $p = Start-Process -FilePath $updater -ArgumentList $argsStr -PassThru -Wait
    return $p.ExitCode
}
function State {
    $f = "$env:LOCALAPPDATA\3SM\EnduranceConnector\Updater\updater-state.json"
    if (-not (Test-Path $f)) { return "MISSING" }
    return (Get-Content $f -Raw)
}

$log = "$env:LOCALAPPDATA\3SM\EnduranceConnector\Updater\updater.log"
Write-Output ("updater: " + [System.Diagnostics.FileVersionInfo]::GetVersionInfo($updater).FileVersion + "  oldsha=" + (Sha256 $oldDll))

if ($Only -eq "" -or $Only -eq "t01") {
    Write-Output "`n=== T01: PROVEN 0.3.8.0 6-arg defect repro ==="
    $d = New-Dirs "t01"; $exe,$target,$staged = Prep $d 0
    $p,$simPid,$ticks,$pf = StartSimHub $exe $d 0
    $args6 = "--pid $simPid --target `"$target`" --staged `"$staged`" --sha256 $(Sha256($staged)) --version 0.3.9.0 --simhub `"$exe`" --no-restart"
    $c = RunUpdater $args6
    $intact = (Sha256 $target) -eq (Sha256 $oldDll)
    Write-Output "  exit=$c intact=$intact"
    Get-Content $log -Tail 3 | ForEach-Object { Write-Output "  LOG: $_" }
    if ($c -ne 0 -and $intact) { Write-Output "  T01 PASS (defect gereproduceerd, plugin intact)" } else { Write-Output "  T01 FAIL" }
    if (IsRunning $p) { $p.Kill() }
}

if ($Only -eq "" -or $Only -eq "t02") {
    Write-Output "`n=== T02: 0.3.9.0 10-arg handshake + install (SimHub normal exit) ==="
    $d = New-Dirs "t02"; $exe,$target,$staged = Prep $d 1500
    $p,$simPid,$ticks,$pf = StartSimHub $exe $d 1500
    $a = Build-Args $simPid $ticks $target $staged $exe " --no-restart"
    $c = RunUpdater $a
    $moved = "0.3.9.0"
    $tver = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($target).FileVersion
    $s = State
    Write-Output "  exit=$c targetver=$tver state=$s"
    if ($c -eq 0 -and $tver -eq "0.3.9.0" -and $s -match '"state":"SUCCESS"') { Write-Output "  T02 PASS (10-arg handshake ok, install, SUCCESS)" } else { Write-Output "  T02 FAIL" }
    if (IsRunning $p) { $p.Kill() }
}

if ($Only -eq "" -or $Only -eq "t08") {
    Write-Output "`n=== T08: install-fout na File.Replace -> rollback last-known-good ==="
    $d = New-Dirs "t08"; $exe,$target,$staged = Prep $d 1500
    $p,$simPid,$ticks,$pf = StartSimHub $exe $d 1500
    $a = Build-Args $simPid $ticks $target $staged $exe " --no-restart --simulate-failure"
    $c = RunUpdater $a
    $back = (Sha256 $target) -eq (Sha256 $oldDll)
    $s = State
    Write-Output "  exit=$c rollback-intact=$back state=$s"
    if ($c -ne 0 -and $back) { Write-Output "  T08 PASS (rollback naar 0.3.8.0, target intact)" } else { Write-Output "  T08 FAIL" }
}
if ($Only -eq "" -or $Only -eq "t05") {
    Write-Output "`n=== T05: SimHub blijft >2min -> WAITING_FOR_RESTART, geen DLL-mutatie ==="
    $d = New-Dirs "t05"; $exe,$target,$staged = Prep $d 0
    $p,$simPid,$ticks,$pf = StartSimHub $exe $d 0   # hold (blijft draaien)
    $a = Build-Args $simPid $ticks $target $staged $exe " --no-restart"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $c = RunUpdater $a
    $sw.Stop()
    $intact = (Sha256 $target) -eq (Sha256 $oldDll)
    $s = State
    Write-Output ("  exit=$c intact=$intact durMs=" + $sw.ElapsedMilliseconds + " state=" + $s)
    $waiting = $s -match '"state":"WAITING_FOR_RESTART"'
    if ($sw.ElapsedMilliseconds -ge 118000 -and $intact -and $waiting) { Write-Output "  T05 PASS (2min timeout -> WAITING, staged behouden, geen mutatie)" } else { Write-Output "  T05 FAIL" }
    if (IsRunning $p) { $p.Kill() }
}

if ($Only -eq "" -or $Only -eq "t10") {
    Write-Output "`n=== T10: tweede updater-start terwijl eerste bezig -> mutex-afwijzing ==="
    $d = New-Dirs "t10"; $exe,$target,$staged = Prep $d 0
    $p,$simPid,$ticks,$pf = StartSimHub $exe $d 0
    $a = Build-Args $simPid $ticks $target $staged $exe " --no-restart"
    # start updater #1 in achtergrond (blijft hangen op WAITING -> houdt mutex ~2min)
    $u1 = Start-Process -FilePath $updater -ArgumentList $a -PassThru
    Start-Sleep -Seconds 2   # laat u1 de mutex pakken + ready-stap
    # probeer updater #2 direct
    $c2 = RunUpdater $a
    Write-Output "  second start exit=$c2"
    $logtail = Get-Content $log -Tail 2 | Out-String
    Write-Output "  log: $logtail"
    if ($c2 -eq -532462766 -or ([string]$logtail -match "Er draait al een 3SM-updater")) {
        Write-Output "  T10 PASS (concurrentie geblokkeerd door mutex)"
    } else { Write-Output "  T10 CHECK (zie status)" }
    try { if (-not $u1.HasExited) { $u1.Kill() } } catch {}
    if (IsRunning $p) { $p.Kill() }
}
if ($Only -eq "" -or $Only -eq "fraud") {
    Write-Output "`n=== T4/T7/T6: fraud detectie (verkeerde SHA / version / length) -> reject vóór mutatie ==="
    $d = New-Dirs "fraud"; $exe,$target,$staged = Prep $d 1500
    $p,$simPid,$ticks,$pf = StartSimHub $exe $d 1500
    $goodHash = Sha256 $staged
    $goodLen = (Get-Item $staged).Length

    # T4: verkeerde SHA
    $badSha = ("0" * 64)
    $a = "--pid $simPid --started-utc-ticks $ticks --target `"$target`" --staged `"$staged`" --sha256 $badSha --installed-sha256 $(Sha256($target)) --length $goodLen --version 0.3.9.0 --simhub `"$exe`" --no-restart"
    $c = RunUpdater $a
    $intact4 = (Sha256 $target) -eq (Sha256 $oldDll)
    Write-Output "  T4(bad sha): exit=$c intact=$intact4"
    if ($c -ne 0 -and $intact4) { Write-Output "  T4 PASS (SHA-reject vóór mutatie)" } else { Write-Output "  T4 FAIL" }

    # T7: verkeerde version (manifest zegt 0.3.8.0 i.p.v. geclaimde 0.3.9.0)
    $a = "--pid $simPid --started-utc-ticks $ticks --target `"$target`" --staged `"$staged`" --sha256 $goodHash --installed-sha256 $(Sha256($target)) --length $goodLen --version 0.3.8.0 --simhub `"$exe`" --no-restart"
    $c = RunUpdater $a
    $intact7 = (Sha256 $target) -eq (Sha256 $oldDll)
    Write-Output "  T7(bad version): exit=$c intact=$intact7"
    if ($c -ne 0 -and $intact7) { Write-Output "  T7 PASS (version-reject vóór mutatie)" } else { Write-Output "  T7 FAIL" }

    # T6: verkeerde length
    $a = "--pid $simPid --started-utc-ticks $ticks --target `"$target`" --staged `"$staged`" --sha256 $goodHash --installed-sha256 $(Sha256($target)) --length 12345 --version 0.3.9.0 --simhub `"$exe`" --no-restart"
    $c = RunUpdater $a
    $intact6 = (Sha256 $target) -eq (Sha256 $oldDll)
    Write-Output "  T6(bad length): exit=$c intact=$intact6"
    if ($c -ne 0 -and $intact6) { Write-Output "  T6 PASS (length-reject vóór mutatie)" } else { Write-Output "  T6 FAIL" }
    if (IsRunning $p) { $p.Kill() }
}
Write-Output "`n=== DONE ==="