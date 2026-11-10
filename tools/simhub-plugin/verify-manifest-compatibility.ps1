# Read-only validation against the actual built/installed DLL.
# Never starts SimHub, installs a plugin, or changes updater settings.
# Explicit SDK loading avoids recursive PowerShell AssemblyResolve handlers.
param(
 [string]$Dll = 'C:\Program Files (x86)\SimHub\3SM.EnduranceConnector.dll',
 [Parameter(Mandatory=$true)][string]$ManifestPath,
 [string]$ExpectedDllVersion,
 [string]$ExpectedManifestVersion,
 [switch]$RequireNewer
)
$ErrorActionPreference = 'Stop'
$simhub = 'C:\Program Files (x86)\SimHub'
foreach ($name in @('log4net.dll','GameReaderCommon.dll','SimHub.Logging.dll','SimHub.Plugins.dll')) {
 $path = Join-Path $simhub $name
 if (Test-Path $path) { [void][Reflection.Assembly]::LoadFrom($path) }
}
try {
 $asm = [Reflection.Assembly]::LoadFrom($Dll)
 $type = $asm.GetType('ThreeSM.EnduranceConnector.EnduranceConnectorPlugin',$true)
 $dto = $asm.GetType('ThreeSM.EnduranceConnector.VersionResponse',$true)
 $flags = [Reflection.BindingFlags]'Static,NonPublic,Public'
 $validate = $type.GetMethod('ValidateReleaseManifest',$flags)
 if (-not $validate) { throw 'ValidateReleaseManifest ontbreekt' }
 $manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
 if ($ExpectedManifestVersion -and $manifest.version -ne $ExpectedManifestVersion) { throw "Unexpected manifest version" }
 function New-Response {
  $o = [Activator]::CreateInstance($dto)
  foreach ($pair in @(@('Version','version'),@('DllUrl','dllUrl'),@('Sha256','sha256'),@('ByteLength','byteLength'),@('FileName','fileName'),@('Signature','signature'))) {
   $property = $dto.GetProperty($pair[0])
   $value = $manifest.($pair[1])
   if ($pair[0] -eq 'ByteLength') { $value = [long]$value }
   $property.SetValue($o,$value,$null)
  }
  return $o
 }
 $version = [Version]::Parse($manifest.version)
 $info = New-Response
 if (-not $validate.Invoke($null,@($info,$version))) { throw 'Het echte ondertekende manifest wordt afgewezen' }
 $checks = @('signed_manifest_accepted')
 foreach ($key in @('Sha256','ByteLength','FileName','DllUrl','Signature')) {
  $bad = New-Response
  $prop = $dto.GetProperty($key)
  switch ($key) {
   'Sha256' { $value = ('0'*64) }
   'ByteLength' { $value = [long]($manifest.byteLength+1) }
   'FileName' { $value = 'incorrect.dll' }
   'DllUrl' { $value = 'https://example.invalid/incorrect.dll' }
   'Signature' { $value = 'AAAA' }
  }
  $prop.SetValue($bad,$value,$null)
  if ($validate.Invoke($null,@($bad,$version))) { throw "Onjuiste $key werd geaccepteerd" }
  $checks += ('reject_'+$key)
 }
 $updater = @($asm.GetManifestResourceNames() | Where-Object { $_ -like '*3SM.EnduranceConnector.Updater.exe' })
 if ($updater.Count -ne 1) { throw 'Embedded updater ontbreekt of is dubbel' }
 $policy = $asm.GetType('ThreeSM.EnduranceConnector.UpdateVersionPolicy',$true).GetMethod('IsNewer',$flags)
 $local = $asm.GetName().Version
 $newer = [bool]$policy.Invoke($null,@($version,$local))
 if ($ExpectedDllVersion -and $local.ToString() -ne $ExpectedDllVersion) { throw "Unexpected DLL version" }
 if ($RequireNewer -and -not $newer) { throw "The old connector would not offer this update" }
 [pscustomobject]@{dllVersion=$local.ToString();manifestVersion=$version.ToString();newerOffered=$newer;checks=$checks;embeddedUpdater=$true;processesStarted=$false} | ConvertTo-Json -Depth 4
} finally {
 # No SimHub processes or assemblies are modified by this probe.
}