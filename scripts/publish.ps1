#!/usr/bin/env pwsh
# Build, push web+full renditions to R2, deploy the site to Cloudflare Pages.
# One-time prereqs: see "Phase 0" below (rclone remote "r2", wrangler login, Pages project).
param(
    [switch]$SkipBuild,     # deploy what's already in build/ + .r2-stage/
    [switch]$DryRun         # show what rclone would transfer; no deploy
)
$ErrorActionPreference = 'Stop'
$root  = Split-Path $PSScriptRoot
$build = Join-Path $root 'build'
$stage = Join-Path $root '.r2-stage'

Push-Location $root
try {
    # Preflight: fail fast with actionable messages
    foreach ($tool in 'rclone', 'wrangler', 'node') {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not installed" }
    }
    if (-not (rclone listremotes | Select-String -SimpleMatch 'r2:')) {
        throw "rclone remote 'r2' is not configured - see docs/design/components/07-publish-pipeline.md"
    }

    if (-not $SkipBuild) { & (Join-Path $PSScriptRoot 'build.ps1') }
    if (-not (Test-Path $stage)) { throw "Nothing staged in .r2-stage - run build.ps1 first" }

    # Push renditions to R2: only changed files upload; never deletes remote objects
    $rcloneArgs = @('copy', $stage, 'r2:pictures-elton', '--checksum', '--transfers', '8', '--progress')
    if ($DryRun) { $rcloneArgs += '--dry-run' }
    rclone @rcloneArgs
    if ($LASTEXITCODE -ne 0) { throw 'rclone copy failed' }

    if ($DryRun) {
        Write-Host 'Dry run - skipping deploy'
    } else {
        wrangler pages deploy $build --project-name pictures --commit-dirty=true
        if ($LASTEXITCODE -ne 0) { throw 'wrangler deploy failed' }

        Write-Host 'Published -> https://pictures.elton.stoneman.io'
    }
}
finally { Pop-Location }
