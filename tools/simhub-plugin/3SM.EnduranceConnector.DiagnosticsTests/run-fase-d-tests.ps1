# Fase D / baseline-harness.
#
# Draait het testproject (net8.0). De vroegere csc-lijst met losse bestanden is vervangen:
# die liep uit de pas met de csproj (nieuwe bestanden werden vergeten, waardoor de harness
# niet meer bouwde) en kon de nieuwe tests niet compileren. Vereist: .NET 8 SDK.
$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot '3SM.EnduranceConnector.DiagnosticsTests.csproj'
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw '.NET 8 SDK (dotnet) ontbreekt; de harness bouwt niet met de oude csc uit .NET Framework.'
}
& dotnet run -c Release --project $project
exit $LASTEXITCODE
