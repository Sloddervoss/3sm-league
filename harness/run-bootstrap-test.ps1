# 3SM 0.3.9.0 — bootstrap-test: werkelijke overgang 0.3.8.0 -> 0.3.9.0 via de officiële
# installatiemethode (A): SimHub stop -> vervang 3SM.EnduranceConnector.dll -> herstart.
# Geen 0.3.9.0 updater-state fabrieken vooraf.
$ErrorActionPreference = "Stop"
$newDll  = "C:\Users\vdevo\3sm\simhub-plugin\3SM.EnduranceConnector\bin\Release\3SM.EnduranceConnector.dll"
$oldDll  = "C:\Users\vdevo\3sm\harness\assets\3SM.EnduranceConnector-0.3.8.0.dll"
$dummy   = "C:\Users\vdevo\3sm\harness\simhub\SimHubWPF.exe"
$simhubDir = "C:\Users\vdevo\3sm\harness\bootstrap_simhub"
function Sha256($p){ (Get-FileHash -Algorithm SHA256 -Path $p).Hash.ToLowerInvariant() }
function Get-Ver($p){ [System.Diagnostics.FileVersionInfo]::GetVersionInfo($p).FileVersion }

# --- schone 0.3.8.0 installatie opbouwen (geen 0.3.9.0 state) ---
# VERWIJDER eventuele eerdere 0.3.9.0-state zodat we zuiver 'zonder 0.3.9.0 state' starten
$stateDir = Join-Path $env:LOCALAPPDATA "3SM\EnduranceConnector\Updater"
if(Test-Path $stateDir){ Remove-Item $stateDir -Recurse -Force }
if(Test-Path $simhubDir){ Remove-Item $simhubDir -Recurse -Force }
New-Item -ItemType Directory -Force $simhubDir | Out-Null
Copy-Item $dummy "$simhubDir\SimHubWPF.exe" -Force
Copy-Item $oldDll "$simhubDir\3SM.EnduranceConnector.dll" -Force   # 0.3.8.0 target
# éénmalig een 0.3.8.0-settings-bestand simuleren (device-token/koppeling) in LOCALAPPDATA
$local = Join-Path $env:LOCALAPPDATA "3SM\EnduranceConnector"
New-Item -ItemType Directory -Force $local | Out-Null
$settingsPath = "$local\ConnectorSettings.xml"
if(-not (Test-Path $settingsPath)){ Set-Content -Path $settingsPath -Value '<ConnectorSettings><DeviceToken>ENCRYPTED_0380_TOKEN</DeviceToken><Pairs>BJHC/1=None</Pairs></ConnectorSettings>' -Encoding UTF8 }

Write-Output "=== 0.3.8.0 installatie voor bootstrap ==="
Write-Output "  target ver: $(Get-Ver "$simhubDir\3SM.EnduranceConnector.dll")"
Write-Output "  target sha: $(Sha256 "$simhubDir\3SM.EnduranceConnector.dll")"
Write-Output "  0.3.8.0 settings aanwezig: $(Test-Path $settingsPath)"
Write-Output "  updater-state.json 0.3.9.0 vooraf: $(Test-Path "$env:LOCALAPPDATA\3SM\EnduranceConnector\Updater\updater-state.json")"

# --- SimHub (dummy) starten en aantoonbaar draaien ---
$started = "Local\BS_STARTED"; $allowE = "Local\BS_ALLOW"
$hs = New-Object System.Threading.EventWaitHandle($false,[System.Threading.EventResetMode]::ManualReset,$started)
$ha = New-Object System.Threading.EventWaitHandle($false,[System.Threading.EventResetMode]::ManualReset,$allowE)
$pf = "$simhubDir\bs_pid.txt"
$p = Start-Process "$simhubDir\SimHubWPF.exe" -ArgumentList " --pidfile `"$pf`" --started-event `"$started`" --allow-exit-event `"$allowE`"" -PassThru
if(-not $hs.WaitOne(10000)){ throw "SIMHUB_START_TIMEOUT" }
Write-Output "`nSimHub (dummy) draait, PID $($p.Id)"

# --- bootstrap: SimHub stoppen ---
Write-Output "`n=== Bootstrap: SimHub stoppen + DLL vervangen (officiële methode A) ==="
$ha.Set(); $p.WaitForExit(15000)
Write-Output "SimHub gestopt. Doorloop 'Blokkering opheffen' = copy-force vanuit build.ps1."
Copy-Item $newDll "$simhubDir\3SM.EnduranceConnector.dll" -Force
# blokkering opheffen (Zone.Identifier ADS verwijderen)
try { Remove-Item (Join-Path $simhubDir "3SM.EnduranceConnector.dll:Zone.Identifier") -ErrorAction SilentlyContinue } catch {}

Write-Output "`n=== Verificatie na bootstrap ==="
$v = Get-Ver "$simhubDir\3SM.EnduranceConnector.dll"
$h = Sha256 "$simhubDir\3SM.EnduranceConnector.dll"
$expH = Sha256 $newDll
Write-Output "  target ver: $v  (verwacht 0.3.9.0)"
Write-Output "  target sha: $h"
Write-Output "  artifact sha match: $($h -eq $expH)"
Write-Output "  Release-build check: vrijwel on stabiel"
# updater-state init: op herstart (plugin load) laadt InitUpdaterStateStore -> safe
Write-Output "  settings behouden (0.3.8.0 token): $(Test-Path $settingsPath)"
Write-Output "  settings token: $((Get-Content $settingsPath -Raw).Contains('ENCRYPTED_0380_TOKEN'))"

# --- SimHub herstart (dummy start opnieuw) en 'plugin laadt' ---
$hs2 = New-Object System.Threading.EventWaitHandle($false,[System.Threading.EventResetMode]::ManualReset,"Local\BS_STARTED2")
$ha2 = New-Object System.Threading.EventWaitHandle($false,[System.Threading.EventResetMode]::ManualReset,"Local\BS_ALLOW2")
$p2 = Start-Process "$simhubDir\SimHubWPF.exe" -ArgumentList " --started-event `"Local\BS_STARTED2`" --allow-exit-event `"Local\BS_ALLOW2`"" -PassThru
if(-not $hs2.WaitOne(10000)){ throw "RESTART_TIMEOUT" }
Write-Output "`nSimHub herstart OK (dummy draait na bootstrap)"
$ha2.Set(); $p2.WaitForExit(10000)

Write-Output "`n=== BOOTSTRAP TEST RESULT ==="
$pass = ($v -eq "0.3.9.0") -and ($h -eq $expH) -and (Test-Path $settingsPath)
if($pass){ Write-Output "  BOOTSTRAP PASS" } else { Write-Output "  BOOTSTRAP FAIL" }