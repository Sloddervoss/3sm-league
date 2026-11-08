param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$ratingsConnector = Join-Path $PSScriptRoot '../3SM.EnduranceConnector'
if (-not $SkipBuild) { & (Join-Path $ratingsConnector 'build.ps1') }
$ratingsDll = Join-Path $ratingsConnector 'bin/Release/3SM.EnduranceConnector.dll'
if (-not (Test-Path -LiteralPath $ratingsDll)) { throw 'Bouw de connector eerst.' }
$ratingsVswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$ratingsCompiler = & $ratingsVswhere -latest -products '*' -find MSBuild\**\Bin\Roslyn\csc.exe | Select-Object -First 1
if (-not $ratingsCompiler) { throw 'Roslyn-compiler uit Visual Studio Build Tools ontbreekt.' }
$ratingsExe = Join-Path $ratingsConnector 'bin/Release/DriverRatingTests.exe'
& $ratingsCompiler /nologo /target:exe /define:DRIVER_RATING_STANDALONE "/out:$ratingsExe" "/reference:$ratingsDll" /reference:System.Runtime.Serialization.dll (Join-Path $PSScriptRoot 'DriverRatingTests.cs') (Join-Path $PSScriptRoot 'DriverRatingRunner.cs')
if ($LASTEXITCODE -ne 0) { throw 'Compilatie van ratingtests mislukt.' }
& $ratingsExe
exit $LASTEXITCODE
