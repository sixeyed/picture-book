BeforeAll {
    $env:PATH = '/opt/homebrew/bin:' + $env:PATH

    $script:RepoRoot = Split-Path $PSScriptRoot
    $script:NewGigScript = Join-Path $PSScriptRoot 'new-gig.ps1'
    $script:GigsDir = Join-Path $script:RepoRoot 'gigs'
    $script:OriginalsDir = Join-Path $script:RepoRoot 'originals'

    # Track every slug this run creates under gigs/ and originals/ so AfterAll
    # can remove them even if a test fails partway through.
    $script:CreatedSlugs = @()

    # Runs new-gig.ps1 as a genuine child pwsh process (not via the `&` call
    # operator in-process) so that its terminating errors surface as a process
    # exit code, exactly as they would for a real invocation from a shell —
    # rather than as a .NET exception unwinding into the test runner itself.
    function Invoke-NewGig {
        param([string[]]$ScriptArgs)
        $output = & pwsh -NoProfile -File $script:NewGigScript @ScriptArgs *>&1
        [pscustomobject]@{
            Output   = $output
            ExitCode = $LASTEXITCODE
        }
    }

    function New-FixtureSource {
        # One tiny landscape JPEG and one tiny EXIF-free portrait JPEG, in a
        # fresh temp directory. Returns the directory path.
        #
        # sharp lives in this repo's node_modules, and `node -e` resolves bare
        # specifiers against the process's cwd at launch — so this must run
        # with the repo root as the working directory (Push-Location below),
        # even though the generated files are written to an absolute temp path.
        $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("new-gig-src-" + [guid]::NewGuid())
        New-Item -ItemType Directory -Path $dir -Force | Out-Null

        $landscape = (Join-Path $dir 'P1000001.jpg') -replace '\\', '/'
        $portrait = (Join-Path $dir 'P1000002.jpg') -replace '\\', '/'

        $nodeScript = @"
import sharp from 'sharp';
await sharp({ create: { width: 40, height: 30, channels: 3, background: '#336699' } })
  .jpeg()
  .toFile('$landscape');
await sharp({ create: { width: 30, height: 40, channels: 3, background: '#996633' } })
  .jpeg()
  .toFile('$portrait');
"@
        Push-Location $script:RepoRoot
        try {
            node --input-type=module -e $nodeScript
            if ($LASTEXITCODE -ne 0) { throw "failed to generate fixture JPEGs" }
        } finally {
            Pop-Location
        }

        return $dir
    }

    function Remove-Gig {
        param([string]$Slug)
        $jsonPath = Join-Path $script:GigsDir "$Slug.json"
        $dir = Join-Path $script:OriginalsDir $Slug
        if (Test-Path $jsonPath) { Remove-Item $jsonPath -Force }
        if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    }

    function New-Slug {
        param([string]$Prefix = 'pester-test')
        $slug = "$Prefix-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        $script:CreatedSlugs += $slug
        return $slug
    }

    $script:FixtureSource = New-FixtureSource
}

AfterAll {
    foreach ($slug in $script:CreatedSlugs) {
        Remove-Gig -Slug $slug
    }
    if ($script:FixtureSource -and (Test-Path $script:FixtureSource)) {
        Remove-Item $script:FixtureSource -Recurse -Force
    }
    # originals/ may have been left empty by New-Item creating it fresh; tidy up
    if ((Test-Path $script:OriginalsDir) -and
        -not (Get-ChildItem $script:OriginalsDir -Force -ErrorAction SilentlyContinue)) {
        Remove-Item $script:OriginalsDir -Force
    }
}

Describe 'new-gig.ps1' {

    Context 'happy path' {
        BeforeAll {
            $script:Slug = New-Slug -Prefix 'happy-path'
            $script:Result = Invoke-NewGig -ScriptArgs @('-Source', $script:FixtureSource, '-Slug', $script:Slug)
        }

        It 'exits zero' {
            $script:Result.ExitCode | Should -Be 0 -Because ($script:Result.Output -join "`n")
        }

        It 'copies the JPEG files into originals/<slug>/' {
            $dir = Join-Path $script:OriginalsDir $script:Slug
            Test-Path (Join-Path $dir 'P1000001.jpg') | Should -BeTrue
            Test-Path (Join-Path $dir 'P1000002.jpg') | Should -BeTrue
        }

        It 'writes gigs/<slug>.json' {
            Test-Path (Join-Path $script:GigsDir "$($script:Slug).json") | Should -BeTrue
        }

        It 'has two images in name order' {
            $gig = Get-Content (Join-Path $script:GigsDir "$($script:Slug).json") -Raw | ConvertFrom-Json
            $gig.images.Count | Should -Be 2
            $gig.images[0].file | Should -Be 'P1000001.jpg'
            $gig.images[1].file | Should -Be 'P1000002.jpg'
        }

        It 'gives the portrait entry height > width (EXIF-free source)' {
            $gig = Get-Content (Join-Path $script:GigsDir "$($script:Slug).json") -Raw | ConvertFrom-Json
            $portrait = $gig.images | Where-Object { $_.file -eq 'P1000002.jpg' }
            $portrait.height | Should -BeGreaterThan $portrait.width
        }

        It 'sets cover to the first file' {
            $gig = Get-Content (Join-Path $script:GigsDir "$($script:Slug).json") -Raw | ConvertFrom-Json
            $gig.cover | Should -Be 'P1000001.jpg'
        }
    }

    Context 'metadata and layout shape' {
        BeforeAll {
            $script:Slug = New-Slug -Prefix 'shape'
            # Single artist: passing a real string[] to `pwsh -File` isn't
            # possible (that's a native-call concern); the script's N->N mapping
            # is trivial. Assert the object shape instead.
            Invoke-NewGig -ScriptArgs @('-Source', $script:FixtureSource, '-Slug', $script:Slug,
                '-Venue', 'Test Hall', '-Location', 'Nowhere', '-Artists', 'Act One') | Out-Null
            $script:Gig = Get-Content (Join-Path $script:GigsDir "$($script:Slug).json") -Raw | ConvertFrom-Json
        }

        It 'writes venue as an object with name, location and empty links' {
            $script:Gig.venue.name | Should -Be 'Test Hall'
            $script:Gig.venue.location | Should -Be 'Nowhere'
            @($script:Gig.venue.links).Count | Should -Be 0
        }

        It 'writes each artist as an object with a name and empty links' {
            @($script:Gig.artists).Count | Should -Be 1
            $script:Gig.artists[0].name | Should -Be 'Act One'
            @($script:Gig.artists[0].links).Count | Should -Be 0
        }

        It 'has no top-level location field' {
            $script:Gig.PSObject.Properties.Name | Should -Not -Contain 'location'
        }

        It 'sets a 3-column layout' {
            $script:Gig.layout.columns | Should -Be 3
        }

        It 'seeds the landscape into the centre column and the portrait into an outer column' {
            $landscape = $script:Gig.images | Where-Object { $_.file -eq 'P1000001.jpg' }
            $portrait = $script:Gig.images | Where-Object { $_.file -eq 'P1000002.jpg' }
            $landscape.column | Should -Be 1
            $portrait.column | Should -Be 0
        }

        It 'writes column values as integers, not floats' {
            $raw = Get-Content (Join-Path $script:GigsDir "$($script:Slug).json") -Raw
            $raw | Should -Not -Match '"column":\s*\d+\.\d'
        }
    }

    Context 'resulting JSON' {
        BeforeAll {
            $script:Slug = New-Slug -Prefix 'valid-json'
            Invoke-NewGig -ScriptArgs @('-Source', $script:FixtureSource, '-Slug', $script:Slug) | Out-Null
        }

        It 'passes validateGig' {
            $jsonPath = (Join-Path $script:GigsDir "$($script:Slug).json") -replace '\\', '/'
            $libPath = (Join-Path $script:RepoRoot 'scripts/lib/gigs.mjs') -replace '\\', '/'
            $nodeScript = @"
import { validateGig } from '$libPath';
import { readFile } from 'node:fs/promises';
const gig = JSON.parse(await readFile('$jsonPath', 'utf8'));
const errors = validateGig(gig, '$($script:Slug).json');
if (errors.length) { console.error(JSON.stringify(errors)); process.exit(1); }
"@
            $result = node --input-type=module -e $nodeScript 2>&1
            $LASTEXITCODE | Should -Be 0 -Because ($result -join "`n")
        }
    }

    Context 'invalid slug' {
        It 'exits non-zero and writes no files for slug "Bad Slug"' {
            $slug = 'Bad Slug'
            $jsonPath = Join-Path $script:GigsDir "$slug.json"
            $dir = Join-Path $script:OriginalsDir $slug

            $result = Invoke-NewGig -ScriptArgs @('-Source', $script:FixtureSource, '-Slug', $slug)

            $result.ExitCode | Should -Not -Be 0
            Test-Path $jsonPath | Should -BeFalse
            Test-Path $dir | Should -BeFalse
        }
    }

    Context 'existing slug without -Force' {
        BeforeAll {
            $script:Slug = New-Slug -Prefix 'existing-no-force'
            Invoke-NewGig -ScriptArgs @('-Source', $script:FixtureSource, '-Slug', $script:Slug) | Out-Null

            $script:JsonPath = Join-Path $script:GigsDir "$($script:Slug).json"
            $script:OriginalJsonContent = Get-Content $script:JsonPath -Raw
            $script:OriginalsSubDir = Join-Path $script:OriginalsDir $script:Slug
            $script:OriginalFileList = Get-ChildItem $script:OriginalsSubDir | Select-Object -ExpandProperty Name

            $script:SecondResult = Invoke-NewGig -ScriptArgs @('-Source', $script:FixtureSource, '-Slug', $script:Slug)
        }

        It 'exits non-zero' {
            $script:SecondResult.ExitCode | Should -Not -Be 0
        }

        It 'leaves the existing JSON untouched' {
            (Get-Content $script:JsonPath -Raw) | Should -Be $script:OriginalJsonContent
        }

        It 'leaves the existing originals files untouched' {
            $currentFiles = Get-ChildItem $script:OriginalsSubDir | Select-Object -ExpandProperty Name
            $currentFiles | Should -Be $script:OriginalFileList
        }
    }

    Context 'existing slug with -Force' {
        BeforeAll {
            $script:Slug = New-Slug -Prefix 'existing-force'
            Invoke-NewGig -ScriptArgs @('-Source', $script:FixtureSource, '-Slug', $script:Slug, '-Title', 'Before') | Out-Null

            $script:Result = Invoke-NewGig -ScriptArgs @('-Source', $script:FixtureSource, '-Slug', $script:Slug, '-Title', 'After', '-Force')
        }

        It 'exits zero' {
            $script:Result.ExitCode | Should -Be 0 -Because ($script:Result.Output -join "`n")
        }

        It 'regenerates the JSON with the new values' {
            $gig = Get-Content (Join-Path $script:GigsDir "$($script:Slug).json") -Raw | ConvertFrom-Json
            $gig.title | Should -Be 'After'
        }
    }

    Context 'source with zero JPEGs' {
        It 'exits non-zero' {
            $emptyDir = Join-Path ([System.IO.Path]::GetTempPath()) ("new-gig-empty-" + [guid]::NewGuid())
            New-Item -ItemType Directory -Path $emptyDir -Force | Out-Null
            try {
                $slug = New-Slug -Prefix 'zero-jpegs'
                $result = Invoke-NewGig -ScriptArgs @('-Source', $emptyDir, '-Slug', $slug)
                $result.ExitCode | Should -Not -Be 0
            } finally {
                Remove-Item $emptyDir -Recurse -Force
            }
        }
    }

    Context 'source containing a non-JPEG file' {
        BeforeAll {
            $script:MixedSource = Join-Path ([System.IO.Path]::GetTempPath()) ("new-gig-mixed-" + [guid]::NewGuid())
            New-Item -ItemType Directory -Path $script:MixedSource -Force | Out-Null
            Copy-Item (Join-Path $script:FixtureSource 'P1000001.jpg') (Join-Path $script:MixedSource 'P1000001.jpg')
            Copy-Item (Join-Path $script:FixtureSource 'P1000002.jpg') (Join-Path $script:MixedSource 'P1000002.jpg')
            Set-Content -Path (Join-Path $script:MixedSource 'notes.txt') -Value 'not an image'

            $script:Slug = New-Slug -Prefix 'mixed-files'
            $script:Result = Invoke-NewGig -ScriptArgs @('-Source', $script:MixedSource, '-Slug', $script:Slug)
        }

        AfterAll {
            if ($script:MixedSource -and (Test-Path $script:MixedSource)) {
                Remove-Item $script:MixedSource -Recurse -Force
            }
        }

        It 'prints a warning mentioning the non-JPEG file' {
            ($script:Result.Output -join "`n") | Should -Match 'notes\.txt'
        }

        It 'does not copy the non-JPEG file' {
            $dir = Join-Path $script:OriginalsDir $script:Slug
            Test-Path (Join-Path $dir 'notes.txt') | Should -BeFalse
        }

        It 'still copies the JPEG files' {
            $dir = Join-Path $script:OriginalsDir $script:Slug
            Test-Path (Join-Path $dir 'P1000001.jpg') | Should -BeTrue
            Test-Path (Join-Path $dir 'P1000002.jpg') | Should -BeTrue
        }
    }
}
