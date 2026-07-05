#!/usr/bin/env pwsh
# Seed the local (simulated) R2 bucket from .r2-stage - run after build.ps1.
$ErrorActionPreference = 'Stop'
$root  = Split-Path $PSScriptRoot
$stage = Join-Path $root '.r2-stage'
if (-not (Test-Path $stage)) { throw 'Nothing staged - run build.ps1 first' }

Get-ChildItem $stage -Recurse -File | ForEach-Object {
    $key = [IO.Path]::GetRelativePath($stage, $_.FullName) -replace '\\', '/'
    npx wrangler r2 object put "pictures-elton/$key" --file $_.FullName --local | Out-Null
    Write-Host "seeded $key"
}
