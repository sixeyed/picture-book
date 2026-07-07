# Component 3 — Rendition Pipeline: `build-images.mjs` + `build.ps1`

Generates the three renditions for every image of every gig (incrementally), and
orchestrates the full local build: validate content → images → Eleventy.

**Files:**
- Create: `scripts/build-images.mjs`
- Create: `scripts/build.ps1`

**Interfaces:**
- Consumes: `loadGigs()` from `scripts/lib/gigs.mjs` (component 1); originals in
  `originals/<slug>/`.
- Produces (contract §3.4 of the overview):
  - `build/thumbs/<slug>/<file>` — 1600 px long edge, JPEG q80, metadata stripped
    (bumped from 600 for hi-DPI sharpness in the column layout — see 09)
  - `.r2-stage/web/<slug>/<file>` — 2048 px long edge, JPEG q85, metadata stripped
  - `.r2-stage/full/<slug>/<file>` — byte-for-byte copy, **only when**
    `gig.permission !== "display-only"`
- Exit code 0 on success; non-zero with errors on stderr otherwise.

---

## 1. `scripts/build-images.mjs`

### CLI

```
node scripts/build-images.mjs [--gig <slug>]
```

`--gig` limits processing to one gig (fast iteration after a new gig). Default: all.

### Behaviour

1. `const gigs = await loadGigs("gigs")` — validation failures abort the build here
   with the loader's aggregated error message.
2. For each gig (filtered by `--gig` if given), for each `images[].file`:
   - Source: `originals/<slug>/<file>`. **Missing source is a hard error** (collect
     all missing files across all gigs, report, exit 1 — catches JSON/folder drift).
   - For each applicable rendition, **skip if the output exists and its mtime ≥ the
     source's mtime** (incremental rebuild).
   - `thumb` / `web`: sharp pipeline —
     `sharp(src).rotate().resize({ width: N, height: N, fit: "inside", withoutEnlargement: true }).jpeg({ quality: Q, mozjpeg: true })`
     with N/Q from the contract table. `.rotate()` (no args) applies EXIF orientation
     and drops the tag — output pixels match `width`/`height` in the gig JSON.
     Metadata is stripped by default (no `.withMetadata()`), which removes GPS/EXIF.
   - `full` (permitted gigs only): `fs.copyFile` — never re-encode originals.
3. Process images with bounded concurrency of 4 (simple worker pool over a shared
   queue — no dependency needed).
4. Stale-output cleanup: if a gig's permission is (or becomes) `display-only`, remove
   any existing `.r2-stage/full/<slug>/` directory. Also remove staged/thumb files
   whose image no longer appears in the gig JSON. (rclone `copy` never deletes on the
   remote, so local cleanup is what keeps R2 from accumulating revoked files —
   see component 7 for the remote-side note.)
5. Summary line, e.g. `4 gigs, 87 images: 12 thumbs, 12 web, 4 full generated; 249 up to date.`

### Sketch of the core loop

```javascript
import { copyFile, mkdir, stat, rm, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { loadGigs } from "./lib/gigs.mjs";

const RENDITIONS = [
  { name: "thumb", edge: 1600, quality: 80, dest: (g, f) => join("build", "thumbs", g, f) },
  { name: "web",   edge: 2048, quality: 85, dest: (g, f) => join(".r2-stage", "web", g, f) },
];

async function isFresh(src, dest) {
  try { return (await stat(dest)).mtimeMs >= (await stat(src)).mtimeMs; }
  catch { return false; }
}

async function processImage(gig, img) {
  const src = join("originals", gig.slug, img.file);
  const jobs = [];
  for (const r of RENDITIONS) {
    const dest = r.dest(gig.slug, img.file);
    if (await isFresh(src, dest)) continue;
    await mkdir(dirname(dest), { recursive: true });
    jobs.push(sharp(src).rotate()
      .resize({ width: r.edge, height: r.edge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: r.quality, mozjpeg: true }).toFile(dest));
  }
  if (gig.permission !== "display-only") {
    const dest = join(".r2-stage", "full", gig.slug, img.file);
    if (!(await isFresh(src, dest))) {
      await mkdir(dirname(dest), { recursive: true });
      jobs.push(copyFile(src, dest));
    }
  }
  await Promise.all(jobs);
}
```

(Full implementation adds: missing-source collection, `--gig` filter, the worker
pool, stale-file cleanup, and the summary counters.)

## 2. `scripts/build.ps1`

```powershell
#!/usr/bin/env pwsh
# Full local build: renditions + static site. Safe to run repeatedly (incremental).
param([string]$Gig)   # optionally limit image processing to one gig
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
Push-Location $root
try {
    if (-not (Test-Path (Join-Path $root 'node_modules'))) { npm install }

    $imgArgs = @()
    if ($Gig) { $imgArgs = @('--gig', $Gig) }
    node scripts/build-images.mjs @imgArgs
    if ($LASTEXITCODE -ne 0) { throw 'Image build failed' }

    npx @11ty/eleventy
    if ($LASTEXITCODE -ne 0) { throw 'Site build failed' }

    Write-Host "Build complete -> $(Join-Path $root 'build')"
}
finally { Pop-Location }
```

Order matters only in that both write under `build/`; Eleventy is configured not to
clean its output dir (default behaviour), so `build/thumbs/` survives.

## 3. Test plan

Runner: `node --test scripts/build-images.test.mjs`, operating in a temp directory
seeded with: one gig JSON (2 images, one portrait, `permission: "editorial"`), one
`display-only` gig, and tiny generated JPEGs (create a 3000×2000 test JPEG with sharp
so resize paths are exercised; and a 400×300 one for the no-upscale case).

| Case | Expect |
|---|---|
| fresh build, editorial gig | thumb + web + full exist for each image; thumb long edge = 1600; web long edge = 2048 |
| display-only gig | no `.r2-stage/full/<slug>/` created |
| 400×300 source | thumb output remains 400×300 (no upscale) |
| EXIF orientation 6 source | output width/height are the rotated dimensions |
| second run, nothing changed | zero files regenerated (compare mtimes before/after) |
| source touched (`utimes` newer) | only that image's renditions regenerate |
| image listed in JSON but file missing | exit 1; message names `originals/<slug>/<file>` |
| image removed from JSON, staged file exists | staged file removed on next run |
| permission editorial → display-only | `.r2-stage/full/<slug>/` removed on next run |
| `--gig <slug>` | other gigs' images untouched |
| metadata check | web rendition has no EXIF block (`sharp(dest).metadata()` → `exif` undefined) |

`build.ps1` itself is covered by the end-to-end acceptance run rather than unit tests.

## 4. Acceptance criteria

- [ ] `node --test scripts/` passes.
- [ ] With one real gig scaffolded by component 2: `./scripts/build.ps1` exits 0 and
      produces `build/thumbs/<slug>/…`, `.r2-stage/web/<slug>/…`, and HTML in `build/`.
- [ ] Second run completes in under ~2 s (all incremental skips).
