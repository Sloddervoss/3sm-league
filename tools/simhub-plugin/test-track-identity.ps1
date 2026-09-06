param([string]$SimHubPath = 'C:\Program Files (x86)\SimHub')
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot '3SM.EnduranceConnector/TrackIdentityReader.cs')
Add-Type -TypeDefinition 'public class TrackTestSnapshot { public object RawData { get; set; } }'
$sdk = [Reflection.Assembly]::LoadFrom((Join-Path $SimHubPath 'iRacingSDK.dll'))
$sample = [Activator]::CreateInstance($sdk.GetType('iRacingSDK.DataSample', $true))
$session = [Activator]::CreateInstance($sdk.GetType('iRacingSDK.SessionData', $true))
$weekend = [Activator]::CreateInstance($sdk.GetType('iRacingSDK.SessionData+_WeekendInfo', $true))
$sample.SessionData = $session
$session.WeekendInfo = $weekend
$snapshot = New-Object TrackTestSnapshot
$snapshot.RawData = $sample
foreach ($id in @(345,434,127,0,-1,2147483648)) {
    $weekend.TrackID = [long]$id
    $actual = [ThreeSM.EnduranceConnector.TrackIdentityReader]::Read($snapshot)
    if ($id -gt 0 -and $id -le [int]::MaxValue) {
        if ($actual -ne $id) { throw "Track ID mismatch: $id" }
    } elseif ($null -ne $actual) { throw 'Invalid ID accepted' }
}
$session.WeekendInfo = $null
if ($null -ne [ThreeSM.EnduranceConnector.TrackIdentityReader]::Read($snapshot)) { throw 'Stale ID retained' }
if ($null -ne [ThreeSM.EnduranceConnector.TrackIdentityReader]::Read($null)) { throw 'Missing snapshot accepted' }
Write-Output 'PASS: actual SDK TrackID, track changes, invalid IDs, missing data, no stale cache'
