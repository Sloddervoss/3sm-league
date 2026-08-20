$ws = "C:\Users\vdevo\3sm\simhub-plugin"
@("3SM.EnduranceConnector","3SM.EnduranceConnector\Assets","3SM.EnduranceConnector.Updater") | ForEach-Object {
    New-Item -ItemType Directory -Force (Join-Path $ws $_) | Out-Null
}
Write-Host "DIRS_CREATED"