param(
    [string]$SimHubPath = "${env:ProgramFiles(x86)}\SimHub",
    [string]$WorkspaceRoot = (Join-Path $PSScriptRoot "simhub-plugin"),
    [switch]$Install
)

$ErrorActionPreference = "Stop"

$project = Join-Path $WorkspaceRoot "3SM.EnduranceConnector\3SM.EnduranceConnector.csproj"
if (-not (Test-Path $project)) { throw "Kan pluginproject niet vinden onder workspace: $WorkspaceRoot" }

$required = @("SimHub.Plugins.dll", "GameReaderCommon.dll", "SimHub.Logging.dll", "log4net.dll")
foreach ($file in $required) {
    if (-not (Test-Path (Join-Path $SimHubPath $file))) { throw "Ontbreekt in SimHub-installatie: $file" }
}

# Vind MSBuild via vswhere of bekende paden.
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$msbuild = $null
if (Test-Path $vswhere) {
    $installPath = & $vswhere -latest -requires Microsoft.Component.MSBuild -property installationPath
    if ($installPath) {
        $candidate = Join-Path $installPath "MSBuild\Current\Bin\MSBuild.exe"
        if (Test-Path $candidate) { $msbuild = $candidate }
    }
}
if (-not $msbuild) {
    $fallbacks = @(
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2019\BuildTools\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles(x86)}\MSBuild\14.0\Bin\MSBuild.exe"
    )
    foreach ($fb in $fallbacks) { if (Test-Path $fb) { $msbuild = $fb; break } }
}
if (-not $msbuild) { throw "MSBuild niet gevonden. Visual Studio Build Tools of Visual Studio 2022 is vereist." }

Write-Host "MSBuild: $msbuild"
Write-Host "Project: $project"

$env:SIMHUB_INSTALL_PATH = (Resolve-Path $SimHubPath).Path.TrimEnd('\') + '\'

# Bouw de Updater eerst (het plugin .csproj embedt het resultaat).
$updaterProj = Join-Path $WorkspaceRoot "3SM.EnduranceConnector.Updater\3SM.EnduranceConnector.Updater.csproj"
if (-not (Test-Path $updaterProj)) { throw "Kan updaterproject niet vinden onder workspace: $WorkspaceRoot" }
Write-Host "Updater builden: $updaterProj"
& $msbuild $updaterProj /restore /t:Rebuild /p:Configuration=Release /p:Platform=AnyCPU
if ($LASTEXITCODE -ne 0) { throw "Updater-build mislukt met code $LASTEXITCODE" }

& $msbuild $project /restore /t:Rebuild /p:Configuration=Release /p:Platform=AnyCPU
if ($LASTEXITCODE -ne 0) { throw "Plugin-build mislukt met code $LASTEXITCODE" }

$projectDir = Split-Path $project -Parent
$output = Join-Path $projectDir "bin\Release\3SM.EnduranceConnector.dll"
if (-not (Test-Path $output)) { throw "Verwachte plugin-DLL ontbreekt: $output" }

$info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($output)
Write-Host "BUILD_OK: $output"
Write-Host "Versie: $($info.FileVersion)"
Write-Host "Grootte: $((Get-Item $output).Length) bytes"
Write-Host "SHA256: $((Get-FileHash $output -Algorithm SHA256).Hash.ToLower())"

if ($Install) {
    $target = Join-Path $SimHubPath "3SM.EnduranceConnector.dll"
    Copy-Item $output $target -Force
    Write-Host "COPIED_TO_SIMHUB: $target"
}

# Ook naar het Vincent-bureaublad kopiëren als de map bestaat.
$desktopBuilds = "$env:USERPROFILE\Desktop\3-stripe-league-hub-main\builds\3sm-enduranceconnector"
if (Test-Path $desktopBuilds) {
    Copy-Item $output (Join-Path $desktopBuilds "3SM.EnduranceConnector.dll") -Force
    Write-Host "COPIED_TO_DESKTOP: $desktopBuilds\3SM.EnduranceConnector.dll"
    New-Item -ItemType File -Path (Join-Path $desktopBuilds "README.md") -Force | Out-Null
    Set-Content (Join-Path $desktopBuilds "README.md") @"
# 3SM EnduranceConnector build
Versie: $($info.FileVersion)
Grootte: $((Get-Item $output).Length) bytes
SHA256: $((Get-FileHash $output -Algorithm SHA256).Hash.ToLower())
Buildtijd: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

Dit bestand is de plugin-DLL voor SimHub. Kopieer naar `C:\Program Files (x86)\SimHub\3SM.EnduranceConnector.dll`,
herstart SimHub, en activeer "3SM Endurance Connector" onder Plugins.
"@
}

Write-Host "--- VERIFICATION ---"
Write-Host "DLL grootte: $((Get-Item $output).Length)"
Write-Host "DLL versie: $($info.FileVersion)"
Write-Host "SHA256: $((Get-FileHash $output -Algorithm SHA256).Hash.ToLower())"