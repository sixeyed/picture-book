# Gig Photo Gallery — Build Spec

A self-hosted, non-destructive photo gallery for live-music shots. Full-resolution
originals live in private object storage; a lightweight static site presents them.
No third-party portfolio host, no ads, own domain, publish-by-script.

---

## 1. Goal

- Public gallery at **`pictures.elton.stoneman.io`**, carrying your name/brand.
- Full-resolution images available to viewers, but **served through the site**, not
  from a public storage URL.
- Everything publishable from the command line after each gig — no dashboard clicking.
- Runs at **£0/month** within Cloudflare's free tiers for a personal-scale archive.

---

## 2. Architecture (decided)

| Layer | Choice | Notes |
|---|---|---|
| Site host | **Cloudflare Pages** | Free, unlimited bandwidth, git or `wrangler` deploy |
| Site domain | `pictures.elton.stoneman.io` | External **CNAME** → `<project>.pages.dev` (add in Pages dashboard *first*) |
| Image storage | **Cloudflare R2** (private bucket) | No public access, no custom domain, no r2.dev |
| Image delivery | **Pages Function + R2 binding** | Streams objects under the site's own domain |
| Source control | Git repo | Code + gig metadata + small thumbnails only |
| Originals | Local + R2 only | **Never committed to git** (binary bloat) |

Key point: because images are served through a Pages Function using an internal R2
**binding**, the bucket needs no hostname of its own and can stay fully private. The
only public identity is the Pages domain.

---

## 3. Repository layout

```
pictures-site/
├── gigs/                    # content: one JSON file per gig (you author these)
│   └── summer-festival-2026.json
├── originals/               # full-res exports — GITIGNORED, pushed to R2 only
│   └── summer-festival-2026/
│       ├── P1000063.jpg
│       └── ...
├── src/                     # site templates + assets
│   ├── _layouts/
│   │   ├── base.njk
│   │   ├── index.njk        # home / gig list
│   │   ├── gig.njk          # single-gig gallery
│   │   └── about.njk
│   ├── assets/
│   │   ├── site.css
│   │   └── gallery.js
│   └── index.njk
├── functions/
│   └── img/
│       └── [[path]].js      # R2 streaming Function
├── build/                   # generated static output — GITIGNORED
├── scripts/
│   ├── new-gig.ps1          # scaffold a gig JSON from an exports folder
│   ├── build.ps1            # generate renditions + build the site
│   └── publish.ps1          # push images to R2 + deploy site
├── wrangler.jsonc           # Pages config + R2 binding
└── .gitignore
```

---

## 4. Content model — gig JSON schema

One file per gig in `gigs/`. This is the single source of truth the build reads.

```json
{
  "slug": "summer-festival-2026",
  "title": "Summer Festival",
  "date": "2026-06-21",
  "venue": "The Foundry",
  "location": "Sheffield, UK",
  "artists": ["The Example Band"],
  "permission": "display-only",
  "cover": "P1000063.jpg",
  "images": [
    { "file": "P1000063.jpg", "orientation": "landscape", "caption": "Full band, mid-set" },
    { "file": "P1000075.jpg", "orientation": "portrait",  "caption": "" }
  ]
}
```

- `permission` — record what the artist agreed to (`display-only`, `editorial`,
  `commercial`). Drives whether a full-res **download** link is shown (see §7g).
- `cover` — image used as the gig's card thumbnail on the home page.
- `orientation` — lets the grid and lightbox lay out portrait vs landscape correctly;
  `new-gig.ps1` can fill this automatically.

---

## 5. Image renditions

Three sizes per photo, generated at build time from the original.

| Rendition | Long edge | Quality | Stored in | Used for |
|---|---|---|---|---|
| `thumb` | 600 px | ~80 | Pages bundle | grid on home + gig pages |
| `web`   | 2048 px | ~85 | R2 (`web/`) | lightbox display view |
| `full`  | original | as exported | R2 (`full/`) | optional download / print |

Rationale: thumbnails are tiny, so bundling them in Pages makes the grid load instantly
with zero Function calls. The heavier `web` and `full` renditions live in R2 and stream
on demand through the Function — cached hard at the edge after first view.

> Display-size guidance from portfolio research: **~2048–2560 px** on the long edge is
> the sweet spot for quality without slowing load. 2048 px is a good default.

---

## 6. Site pages

1. **Home (`/`)** — short intro line + a grid of **gig cards** (cover thumb, title,
   date, venue). Newest first. Each card links to its gig page.
2. **Gig page (`/<slug>/`)** — heading (title, date, venue, artist), then a responsive
   **thumbnail grid**. Clicking a thumb opens the **lightbox** loading the `web`
   rendition; keyboard/swipe to move between shots. Optional per-image caption.
3. **About (`/about/`)** — short bio, contact email, Instagram link.
4. **(Optional) per-image deep links** — shareable URL that opens the lightbox on a
   specific shot.

Curate: aim for **15–30 images per gig**, not the full take.

---

## 7. Components to build

A checklist of everything that needs writing, with each part's job.

**a. `gigs/<slug>.json`** — content per gig. Authored by you (or scaffolded by `new-gig.ps1`).

**b. `scripts/new-gig.ps1`** — takes a folder of full-res exports, creates
`originals/<slug>/`, and writes a `gigs/<slug>.json` stub: lists every file and sets
`orientation` by reading each image's dimensions (`magick identify`). You then fill in
title/venue/captions.

**c. `scripts/build.ps1`** — the rendition pipeline + site build:
- For each gig, generate `thumb` (→ `build/`) and `web` (→ staging for R2) with ImageMagick.
- Copy originals to a `full/` staging path for R2.
- Invoke the static-site generator to render HTML into `build/`.

**d. Static-site generator + templates** — recommend **Eleventy (11ty)** with Nunjucks
for `base`, `index`, `gig`, `about`. (Zero-dependency alternative: a small pwsh/Node
templating pass — more code to maintain. 11ty is the lighter path.)

**e. `src/assets/site.css`** — dark theme, responsive grid (CSS grid / masonry),
typography, lightbox styling.

**f. `src/assets/gallery.js`** — lightbox open/close, keyboard + swipe navigation,
lazy-loading of thumbnails, and (optional) the S/M/L grid-size toggle.

**g. `functions/img/[[path]].js`** — streams an object from the R2 binding by key,
with long-lived immutable cache headers. Serves both `web/…` and `full/…`. Show the
`full/` download link only for gigs whose `permission` allows it.

```javascript
export async function onRequest(context) {
  const { params, env } = context;
  const key = params.path.join("/");            // e.g. "web/summer-festival-2026/P1000063.jpg"
  const object = await env.PHOTOS.get(key);     // PHOTOS = R2 binding
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}
```

**h. `wrangler.jsonc`** — Pages project config with the R2 binding:

```jsonc
{
  "name": "pictures",
  "pages_build_output_dir": "build",
  "r2_buckets": [
    { "binding": "PHOTOS", "bucket_name": "pictures-elton" }
  ]
}
```

**i. `scripts/publish.ps1`** — push renditions to R2 and deploy:

```powershell
#!/usr/bin/env pwsh
# Build, push web+full renditions to R2, deploy the site.
# Prereqs: rclone remote "r2" configured; `wrangler login`; Pages project created once.
$ErrorActionPreference = 'Stop'

$root  = Split-Path $PSScriptRoot
$build = Join-Path $root 'build'
$stage = Join-Path $root '.r2-stage'          # web/ + full/ produced by build.ps1

& (Join-Path $PSScriptRoot 'build.ps1')

# Push image renditions to R2 (zero egress; only changed files upload)
rclone copy $stage 'r2:pictures-elton' --progress --transfers 8 --checksum

# Deploy the static site + Function to Cloudflare Pages
wrangler pages deploy $build --project-name pictures --commit-dirty=true

Write-Host "Published -> https://pictures.elton.stoneman.io"
```

**j. `.gitignore`** — `originals/`, `build/`, `.r2-stage/`, `node_modules/`.

---

## 8. Design direction

Distilled from current gig/photography portfolios (see companion links):

- **Dark theme.** Gig shots are low-key and moody; a dark UI lets the images glow and
  suits the purple stage-light palette. Most concert portfolios go dark or near-black.
- **Photos first, chrome last.** Minimal nav, generous spacing, no clutter. The grid is
  the interface.
- **Responsive grid → lightbox.** Masonry or a simple multi-column grid of thumbnails;
  click to an immersive full-view. Consider Justin Bettman's **S/M/L size toggle** for
  browsing density, and Samuel Angibaud's **click-to-advance** monograph feel in the
  lightbox.
- **Group by gig.** Each event is a set with its own page — matches how you shoot and
  how people want to browse ("that night").
- **Light touch on hover.** Caption or title on hover over a thumb; avoid heavy effects.
- **One clear contact path.** Bio + email + Instagram, nothing more.

---

## 9. Build & publish pipeline

```
darktable export (full-res, per gig)
        │
        ▼
originals/<slug>/         ──(new-gig.ps1)──►  gigs/<slug>.json stub
        │
        ▼   build.ps1
 ┌──────────────┬──────────────┬─────────────────┐
 │ thumb 600px  │  web 2048px   │  full (original) │
 │  → build/    │  → .r2-stage/ │  → .r2-stage/    │
 └──────────────┴──────────────┴─────────────────┘
        │              │                 │
   11ty render     rclone ──────────────►  R2 (private)
        │
        ▼
 wrangler pages deploy build/  ──►  pictures.elton.stoneman.io
```

Run `./scripts/publish.ps1` after each gig. Done.

---

## 10. Delivery phases

**Phase 0 — Cloudflare one-time setup**
Create private R2 bucket; create Pages project; add custom domain in dashboard; add the
external CNAME at your DNS host; confirm the R2 binding.

**Phase 1 — MVP**
Home listing + one real gig page + working lightbox + `build.ps1`/`publish.ps1`. Ship it
end to end with a single gig before adding anything.

**Phase 2 — Content polish**
About/contact page, per-image captions, thumbnail lazy-loading, conditional full-res
download link driven by `permission`.

**Phase 3 — Nice-to-haves**
S/M/L grid toggle, per-image shareable deep links, Open Graph tags for clean social
previews, prefetch of the next lightbox image.

---

## 11. Open decisions

1. **Generator:** Eleventy (recommended) vs a zero-dependency pwsh/Node generator? -> Eleventy
2. **Downloads:** offer a full-res download button at all, or display-only by default
   and enable per gig via `permission`?  -> permission
3. **Captions:** per-image, or a single blurb per gig to save authoring time? -> one per gig
4. **Thumbnails location:** keep in the Pages bundle (fast, recommended) or move to R2
   too if the archive grows very large? -> bundle
5. **Ordering:** manual order in the JSON, or auto by filename/capture time? -> auto