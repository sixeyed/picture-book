# Component 7 — Publish Pipeline: `publish.ps1`, `.gitignore`, Cloudflare Setup

The one command run after each gig: build everything, sync renditions to R2, deploy
the site. Plus the repo hygiene file and the one-time Phase 0 checklist.

**Files:**
- Create: `scripts/publish.ps1`
- Create: `.gitignore`

**Interfaces:**
- Consumes: `build.ps1` (component 3); `.r2-stage/{web,full}/` layout; `build/`
  output; `wrangler.jsonc` project name `pictures` (component 6).
- Produces: objects in R2 bucket `pictures-elton` under `web/` and `full/`; a live
  deployment at `pictures.elton.stoneman.io`.

---

## 1. `scripts/publish.ps1`

```powershell
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
```

Design points:

- **`Push-Location $root` / `finally { Pop-Location }`** — wrangler and rclone both
  resolve config relative to the current directory (`wrangler.jsonc`, `functions/`
  for the Pages Function binding). Without pinning cwd to the repo root, running
  this script from anywhere else silently deploys without the Function/R2 binding.
  The `-DryRun` early exit is inside the `try` block (not a bare `return`) so
  `Pop-Location` always runs.
- **Images before site** — order matters: if the deploy went first, a visitor could
  see a new page whose lightbox images aren't in R2 yet.
- **`rclone copy`, not `sync`** — never deletes remote objects, so a local mishap
  (empty `.r2-stage/`) can't wipe the bucket. Consequence: objects for removed
  images or revoked (`display-only`) gigs linger in R2 until manually pruned. They
  are unreferenced and R2 storage at this scale is pennies; when pruning is wanted,
  run `rclone sync $stage r2:pictures-elton --dry-run` **after a full clean build**
  and inspect before running it for real. Deliberately not automated
  (ASSUMPTIONS.md #9). The same lingering applies to a permission downgrade
  (`editorial` → `display-only`): the gig's already-uploaded `full/` objects stay
  live in R2 — component 3's cleanup only stops the local stage from re-uploading
  them (see component 3) — until that manual prune is run.
- **`--checksum`** — compares hashes instead of times, so rebuilding renditions with
  identical content doesn't re-upload the archive.

## 2. `.gitignore`

```gitignore
node_modules/
originals/
build/
.r2-stage/
.wrangler/
```

(`.wrangler/` holds local dev state including the simulated R2 bucket.)

Note: the repo is not yet a git repository — `git init` is part of Phase 0 below.

## 3. Phase 0 — one-time setup checklist (manual)

1. `git init`; initial commit once components land.
2. **R2:** Cloudflare dashboard → R2 → create bucket `pictures-elton`. No public
   access, no custom domain, no r2.dev URL.
3. **R2 API token for rclone:** R2 → Manage API tokens → create token with
   Object Read & Write scoped to `pictures-elton`. Then `rclone config`:
   type `s3`, provider `Cloudflare`, the access key/secret from the token, endpoint
   `https://<account-id>.r2.cloudflarestorage.com`, remote name **`r2`**.
   Verify: `rclone lsd r2:` lists the bucket.
4. **wrangler:** `npm i -g wrangler` (or use `npx`); `wrangler login`.
5. **Pages project:** `wrangler pages project create pictures` (production branch:
   `main`). First deploy: `wrangler pages deploy build --project-name pictures`.
6. **Custom domain:** Pages dashboard → project → Custom domains → add
   `pictures.elton.stoneman.io` **first**, then at the DNS host for
   `stoneman.io` add `CNAME pictures.elton → pictures.pages.dev`. Wait for the
   cert to issue.
7. **Binding check:** `wrangler.jsonc` carries the R2 binding for Pages; confirm in
   dashboard → project → Settings → Bindings that `PHOTOS → pictures-elton` shows
   after the first deploy with the file present.

## 4. Local dev seeding (optional helper)

To exercise the lightbox locally against wrangler's simulated R2, after a build:

```powershell
Get-ChildItem .r2-stage -Recurse -File | ForEach-Object {
    $key = [IO.Path]::GetRelativePath((Resolve-Path .r2-stage), $_.FullName) -replace '\\','/'
    npx wrangler r2 object put "pictures-elton/$key" --file $_.FullName --local
}
```

Worth wrapping as `scripts/dev-seed.ps1` if used more than once.

## 5. Test plan

The script's value is glue, not logic — verification is a staged end-to-end run:

| Check | Steps |
|---|---|
| preflight failures | temporarily rename rclone remote → script fails with the config message, before building |
| dry run | `./scripts/publish.ps1 -DryRun` → rclone lists pending uploads, no deploy happens |
| first publish | full run → site live on `pictures.pages.dev`; gig page lightbox loads `web` images through `/img/...` |
| idempotence | immediate second run → rclone transfers 0 files |
| custom domain | after DNS: site + images load on `pictures.elton.stoneman.io`; `curl -I` on an image shows `cf-cache-status: HIT` on second request |
| download gating | editorial gig: full-res link downloads; display-only gig: `curl -I /img/full/<slug>/<file>` → 404 |

## 6. Acceptance criteria

- [ ] End-to-end table above passes against the real Cloudflare account with one
      real gig (this is the spec's Phase 1 exit condition).
- [ ] Total cost check: R2 and Pages dashboards show usage comfortably inside free
      tiers after publishing a full gig.
