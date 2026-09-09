# picture-book

A self-hosted, non-destructive photo gallery for live-music shots. Full-resolution
originals live in private Cloudflare R2; a lightweight static site (Cloudflare Pages)
presents them under your own domain — **pictures.sixeyed.com**. No third-party
portfolio host, no ads, publish-by-script. Runs at £0/month at personal scale.

Everything builds, previews, and tests in Docker — no host toolchain needed.

---

## Add a new gig

Assumes Cloudflare is already set up (if not, do [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
Part A once).

**1. Scaffold from your darktable exports.** This copies the JPEGs into
`originals/<slug>/` and writes `gigs/<slug>.json` with pixel dimensions and a starter
3-column layout already filled in:

```bash
pwsh ./scripts/new-gig.ps1 \
  -Source ~/Pictures/exports/<folder> \
  -Slug david-kayode-goods-shed-2026 \
  -Title 'David Kayode' \
  -Date 2026-07-03 \
  -Venue 'Goods Shed' \
  -Location 'Stroud, UK' \
  -Artists 'David Kayode'
```

**2. Edit `gigs/<slug>.json`.** Fill in the bits the scaffolder can't know:

- **`artists` / `venue` links** — add `{ "label": "...", "url": "..." }` entries
  (Instagram, Bandcamp, Website, …). They render as chips in the gig heading.
- **`permission`** — `display-only` (default, no downloads), `editorial`, or
  `commercial`. Anything other than `display-only` shows a full-res download link and
  uploads the originals to R2.
- **`images`** — the array order **is** the display order (and the lightbox order).
  Each image's `column` (0-based) places it; the scaffolder seeds portraits to the
  outer columns and landscapes to the centre. Optionally set
  `layout.widths` (e.g. `[1, 1.07, 1]`) to balance column heights.
- **`description`** — an optional one-line blurb shown under the heading.
- **`cover`** — which image is the home-page card (defaults to the first).

**3. Preview locally** (optional):

```bash
docker compose run --rm build                              # renditions + site → build/
docker compose run --rm shell pwsh scripts/dev-seed.ps1    # load images into local R2
docker compose up web                                      # http://localhost:8788
```

## Publish

```bash
docker compose run --rm build          # build renditions + site in Docker (uses Node 26)
./scripts/publish.ps1 -SkipBuild       # push renditions to R2 + deploy the site
```

That's it — the gig is live at `https://pictures.sixeyed.com`. Commit
`gigs/<slug>.json` to git when you're happy with it.

`publish.ps1` pushes the `web`/`full` renditions to R2 (only changed files) and deploys
the static bundle (HTML + thumbnails) to Pages. Useful flags:
`-DryRun` (show what would upload, no deploy), or drop `-SkipBuild` to build host-side
instead of in Docker (needs host Node ≥ 20).

---

## Everyday commands

```bash
docker compose run --rm build          # generate renditions + build the site
docker compose run --rm test           # run every test (node --test + Pester)
docker compose up web                  # full stack incl. the image Function → :8788
./scripts/publish.ps1 -SkipBuild       # deploy (after a build)
```

## How it's built

- **Content:** one JSON file per gig in `gigs/` (schema in `schema/gig.schema.json`).
- **Renditions:** `scripts/build-images.mjs` (sharp) — bundled thumbnails (`srcset`
  800/1600), plus 2048px `web` and original `full` pushed to R2.
- **Site:** Eleventy (`src/`), a vanilla-JS lightbox, and an explicit column layout.
- **Delivery:** a Cloudflare Pages Function streams private R2 objects under the site's
  own domain.

First-time Cloudflare setup and the deploy model: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.
Design docs and component specs: [`docs/design/`](docs/design/) — start with
[`00-overview.md`](docs/design/components/00-overview.md).
