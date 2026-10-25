$ErrorActionPreference = 'Stop'
# Draait de pure-logica tests van de ResearchRecorder. Geen SimHub-DLL nodig: de harness
# compileert alleen de researchbestanden uit de pluginmap (plus de tests).
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw 'dotnet SDK ontbreekt. Installeer de .NET SDK (net8.0) of draai de tests op Beest.'
}

Push-Location $PSScriptRoot
try {
    & dotnet run --project (Join-Path $PSScriptRoot '3SM.EnduranceConnector.ResearchTests.csproj') -c Release
    if ($LASTEXITCODE -ne 0) { throw "Research harness faalde: $LASTEXITCODE" }
}
finally {
    Pop-Location
}

# Voorbeeld-sessie opnieuw genereren (optioneel):
#   dotnet run -- --sample (Join-Path $root '..\..\docs\research\voorbeeld-sessie.jsonl')
