param(
    [string]$SimHubPath = "${env:ProgramFiles(x86)}\SimHub",
    [switch]$Install
)

$ErrorActionPreference = "Stop"
$project = Join-Path $PSScriptRoot "3SM.EnduranceConnector.csproj"
$required = @("SimHub.Plugins.dll", "GameReaderCommon.dll", "SimHub.Logging.dll", "log4net.dll")
foreach ($file in $required) {
    if (-not (Test-Path (Join-Path $SimHubPath $file))) { throw "Ontbreekt in SimHub-installatie: $file" }
}
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) { throw "Visual Studio 2022 Build Tools met .NET Framework 4.8 targeting pack is vereist." }
$msbuild = & $vswhere -latest -products '*' -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\MSBuild.exe | Select-Object -First 1
if (-not $msbuild) { throw "MSBuild niet gevonden." }
$env:SIMHUB_INSTALL_PATH = (Resolve-Path $SimHubPath).Path.TrimEnd('\') + '\'
& $msbuild $project /restore /t:Rebuild /p:Configuration=Release /p:Platform=AnyCPU
if ($LASTEXITCODE -ne 0) { throw "Pluginbuild mislukt met code $LASTEXITCODE" }
$output = Join-Path $PSScriptRoot "bin\Release\3SM.EnduranceConnector.dll"
if (-not (Test-Path $output)) { throw "Verwachte plugin-DLL ontbreekt: $output" }
if ($Install) {
    Copy-Item $output (Join-Path $SimHubPath "3SM.EnduranceConnector.dll") -Force
    Write-Host "Plugin geïnstalleerd. Herstart SimHub en activeer 3SM Endurance Connector onder Plugins."
} else {
    Write-Host "Build gereed: $output"
    Write-Host "Gebruik -Install om de DLL naar de SimHub-map te kopiëren."
}
