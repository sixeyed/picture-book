<#
.SYNOPSIS
    Scaffold a new gig: copy exported JPEGs into originals/<slug>/ and write a
    gigs/<slug>.json stub with dimensions filled in.

.EXAMPLE
    ./scripts/new-gig.ps1 -Source ~/exports/foundry-jun -Slug summer-festival-2026 `
        -Title 'Summer Festival' -Date 2026-06-21 -Venue 'The Foundry' `
        -Location 'Sheffield, UK' -Artists 'The Example Band','Support Act'
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Source,

    [Parameter(Mandatory = $true)]
    [string]$Slug,

    [string]$Title,

    [string]$Date,

    [string]$Venue = 'TODO',

    [string]$Location = 'TODO',

    [string[]]$Artists = @('TODO'),

    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path $PSScriptRoot

# --- 2. Validate slug -------------------------------------------------------
if ($Slug -notmatch '^[a-z0-9]+(-[a-z0-9]+)*$') {
    Write-Error "Invalid slug '$Slug': must match ^[a-z0-9]+(-[a-z0-9]+)*`$ (lowercase letters, digits, single hyphens)"
}

# --- Defaults ----------------------------------------------------------------
if (-not $Title) {
    $Title = ($Slug -split '-' | ForEach-Object { $_.Substring(0, 1).ToUpper() + $_.Substring(1) }) -join ' '
}
if (-not $Date) {
    $Date = Get-Date -Format 'yyyy-MM-dd'
}

$gigJsonPath = Join-Path $repoRoot 'gigs' "$Slug.json"
$originalsDir = Join-Path $repoRoot 'originals' $Slug

# --- 3. Refuse to clobber an existing gig unless -Force ---------------------
$gigExists = (Test-Path $gigJsonPath) -or (Test-Path $originalsDir)
if ($gigExists -and -not $Force) {
    Write-Error "Gig '$Slug' already exists (gigs/$Slug.json or originals/$Slug/) — use -Force to overwrite"
}

# --- 4. Enumerate source files -----------------------------------------------
if (-not (Test-Path $Source)) {
    Write-Error "Source folder not found: $Source"
}
$resolvedSource = (Resolve-Path -Path $Source).Path

$allFiles = Get-ChildItem -Path $resolvedSource -File
$jpegFiles = @($allFiles | Where-Object { $_.Extension -match '^\.jpe?g$' } | Sort-Object Name)
$otherFiles = @($allFiles | Where-Object { $_.Extension -notmatch '^\.jpe?g$' })

if ($jpegFiles.Count -eq 0) {
    Write-Error "No JPEG files found in '$resolvedSource'"
}

if ($otherFiles.Count -gt 0) {
    Write-Warning "Ignoring non-JPEG file(s), not copied: $($otherFiles.Name -join ', ')"
}

# --- 5. Copy files into originals/<slug>/ -----------------------------------
if ($Force -and (Test-Path $originalsDir)) {
    Remove-Item -Path $originalsDir -Recurse -Force
}
New-Item -ItemType Directory -Path $originalsDir -Force | Out-Null

foreach ($f in $jpegFiles) {
    Copy-Item -Path $f.FullName -Destination (Join-Path $originalsDir $f.Name) -Force
}

# --- 6. Read rotation-corrected dimensions in one call ----------------------
$readDimensionsScript = Join-Path $repoRoot 'scripts/lib/read-dimensions.mjs'
$dimensionsJson = node $readDimensionsScript $originalsDir
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to read image dimensions (node exited $LASTEXITCODE)"
}
$dimensions = $dimensionsJson | ConvertFrom-Json

# --- 7. Write gigs/<slug>.json ------------------------------------------------
# Seed column placement with the same heuristic the site uses: portraits
# alternate into the outer columns, landscapes go to the centre. Edit freely.
$columns = 3
$centre = [int][math]::Floor(($columns - 1) / 2)
$nextOuter = 0
$images = @($dimensions | ForEach-Object {
    if ($_.height -gt $_.width) {
        $col = if ($nextOuter -eq 0) { 0 } else { $columns - 1 }
        $nextOuter = if ($nextOuter -eq 0) { 1 } else { 0 }
    }
    else {
        $col = $centre
    }
    [ordered]@{ file = $_.file; width = $_.width; height = $_.height; column = $col }
})
$cover = $images[0].file

$gig = [ordered]@{
    '$schema'   = '../schema/gig.schema.json'
    slug        = $Slug
    title       = $Title
    date        = $Date
    venue       = [ordered]@{ name = $Venue; location = $Location; links = @() }
    artists     = @($Artists | ForEach-Object { [ordered]@{ name = $_; links = @() } })
    permission  = 'display-only'
    description = ''
    cover       = $cover
    layout      = [ordered]@{ columns = $columns }
    images      = $images
}

$json = $gig | ConvertTo-Json -Depth 6
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($gigJsonPath, $json + "`n", $utf8NoBom)

# --- 8. Summary ---------------------------------------------------------------
Write-Host "Copied $($jpegFiles.Count) image(s) to originals/$Slug/"
Write-Host "Wrote $gigJsonPath"
Write-Host "Next steps: edit title/venue/artist links + description, adjust image order/columns, then run ./scripts/build.ps1"
