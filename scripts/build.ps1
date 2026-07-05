#!/usr/bin/env pwsh
# Full local build: renditions + static site. Safe to run repeatedly (incremental).
param([string]$Gig)   # optionally limit image processing to one gig
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
Push-Location $root
try {
    # Check a marker file npm writes into node_modules, not the directory itself:
    # a compose-managed named volume mounts as an empty node_modules/, so a bare
    # existence check never fires and dependencies are never installed.
    if (-not (Test-Path (Join-Path $root 'node_modules/.package-lock.json'))) { npm install }

    $imgArgs = @()
    if ($Gig) { $imgArgs = @('--gig', $Gig) }
    node scripts/build-images.mjs @imgArgs
    if ($LASTEXITCODE -ne 0) { throw 'Image build failed' }

    npx @11ty/eleventy
    if ($LASTEXITCODE -ne 0) { throw 'Site build failed' }

    Write-Host "Build complete -> $(Join-Path $root 'build')"
}
finally { Pop-Location }
