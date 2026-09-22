# CLAUDE.md

Guidance for Claude Code working in this repo. Read this before making changes.

**Start here: [HANDOFF.md](HANDOFF.md)** — current state, open items and settled
decisions. The build is complete and the site is live at https://pictures.sixeyed.com.

## What this is

A self-hosted gig-photography gallery: a static Eleventy site on Cloudflare Pages,
full-res images in a private Cloudflare R2 bucket, streamed through a Pages Function.
Publish-by-CLI, £0/month. See `README.md` (workflow) and `docs/DEPLOYMENT.md` (deploy).

## Golden rule: keep the design docs in sync

`docs/design/` is the source of truth for the architecture. Component docs are numbered
`00`–`09` (`docs/design/components/`); `00-overview.md` §3 holds the **shared contracts**
(URL scheme, R2 keys, renditions, content model, gallery markup contract). When you
change code, update the matching doc **in the same change** — this has been a firm norm
throughout. `docs/design/ASSUMPTIONS.md` records decisions and reversals.

## Build, test, preview — use Docker

A stale Node **v18** still sits at `/usr/local/bin/node`. As of 2026-09-04 Homebrew's
Node **26** is ahead of it on PATH, so plain `node` is fine — but verify with `node -v`
(want ≥ 20.9) before trusting a host-side run. Two options:
- **Preferred:** run everything in Docker — `docker compose run --rm build|test`,
  `docker compose up web` (full stack incl. the image Function on :8788). Pinned Node 26.
- **Host-side:** prefix with `export PATH=/opt/homebrew/bin:$PATH` to force Homebrew's Node.

Tests:
- Node: **`node --test`** from the repo root (bare form) — this is what `test.ps1` runs.
  (The old `ERR_MODULE_NOT_FOUND` on `node --test scripts/` was a Node 24.2.0 bug; it no
  longer reproduces on Node 26.8.1, but the bare form stays the supported invocation.)
- pwsh: `pwsh -NoProfile -Command "Invoke-Pester scripts/new-gig.tests.ps1 -CI"`.
- Current baseline: **91 node tests + 23 Pester**, all green.

Never commit `originals/`, `build/`, `.r2-stage/`, `node_modules/`, `.wrangler/`
(all gitignored). Commit only when asked; end commit messages with the Co-Authored-By
trailer for Claude.

## Architecture map

| Area | Files |
|---|---|
| Content model (schema + loader/validator) | `schema/gig.schema.json`, `scripts/lib/gigs.mjs` |
| Scaffolder | `scripts/new-gig.ps1`, `scripts/lib/read-dimensions.mjs` |
| Rendition pipeline | `scripts/build-images.mjs`, `scripts/build.ps1` |
| Site generator | `eleventy.config.mjs`, `src/_data/gigs.js`, `src/*.njk` |
| Frontend | `src/assets/site.css`, `src/assets/gallery.js` |
| Image Function | `functions/img/[[path]].js`, `wrangler.jsonc` |
| Publish / Docker | `scripts/publish.ps1`, `scripts/dev-seed.ps1`, `Dockerfile`, `docker-compose.yml` |

## Content model (current — see components 01 & 09)

Gig JSON: `venue` and `artists` are **objects** with optional `links: [{label,url}]`
(no top-level `location` — it lives in `venue`). Image **array order is authoritative**
(display + lightbox order); the loader does not sort. `layout: { columns, widths? }`
plus per-image `column` (0-based) drive an explicit flexbox column layout; missing
columns fall back to portraits-flank / landscapes-centre. `permission` ∈
`display-only | editorial | commercial`.

## Renditions & the gallery

- Thumbnails: **two sizes** (`THUMB_SIZES = [800, 1600]`) → `build/thumbs/<slug>/<stem>-<edge>.jpg`,
  emitted as a `srcset`. `THUMB_SIZES` must stay identical in `build-images.mjs` **and**
  `src/_data/gigs.js`.
- `web` (2048px) + `full` (original) go to R2 under `web/<slug>/<file>` and
  `full/<slug>/<file>`; `full` only for non-`display-only` gigs.
- The gallery grid markup (`.columns` → `.col` → `a.thumb[data-order]`) is a contract in
  overview §3.6; `gallery.js` binds to `.columns` and sorts thumbs by `data-order`.

## Gotchas (learned the hard way)

- **`build.ps1` is the only supported build.** Running Eleventy alone after deleting
  `build/` loses `build/thumbs/` (they're pipeline output, not Eleventy's).
- **Incremental builds are mtime-based** — they won't notice a rendition *size* change.
  Delete `build/thumbs/` to force thumbnail regen.
- **`wrangler pages dev` caches its asset manifest at startup.** After any out-of-band
  change to `build/`, **restart the `web` container** or it serves stale/404s.
- **Immutable 1-year cache** on `/img/...` (set by the Function) and `/thumbs/...`
  (set by `src/_headers`). `/assets/*` is deliberately left revalidating — an
  immutable stylesheet would pin a stale `site.css` on returning visitors for a year.
  A re-edited photo republished
  under the same filename serves stale copies. Rule: rename re-exported images.
- **`rclone copy` never deletes from R2.** Removed/revoked objects linger; prune only via
  a manual, inspected `rclone sync --dry-run` after a clean build.

## Verify changes in the real app

For anything touching layout/rendering, build and look at it in the running stack
(`docker compose up web`, browse :8788) — don't rely on tests alone. Measure in the
browser (bounding boxes, `currentSrc`, computed styles) rather than eyeballing.
