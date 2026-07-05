#!/usr/bin/env pwsh
# Run all automated tests: node --test suites + Pester for the pwsh scripts.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
Push-Location $root
try {
    # Check a marker file npm writes into node_modules, not the directory itself:
    # a compose-managed named volume mounts as an empty node_modules/, so a bare
    # existence check never fires and dependencies are never installed.
    if (-not (Test-Path (Join-Path $root 'node_modules/.package-lock.json'))) { npm install }

    node --test          # bare form: auto-discovers **/*.test.mjs from the repo root
    if ($LASTEXITCODE -ne 0) { throw 'node tests failed' }

    if (Get-Module -ListAvailable Pester) {
        Invoke-Pester (Join-Path $root 'scripts') -CI
        if ($LASTEXITCODE -ne 0) { throw 'Pester tests failed' }
    } else {
        Write-Warning 'Pester not installed - skipping pwsh script tests'
    }
}
finally { Pop-Location }
