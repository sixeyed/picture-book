# HANDOFF — picture-book

**Written 2026-09-04; dependency section updated the same day.** Last commit `5d79fc5` was **2026-07-07** — the repo has been
dormant ~2 months. Read `CLAUDE.md` first (build commands + gotchas), then this.

---

## TL;DR

**The site is LIVE** at `https://picture-book.pages.dev` (first deploy 2026-09-09).
All nine components are implemented and committed; 79 node tests + 23 Pester green.
One real gig is published. R2 holds the 5 `web` renditions (1.23 MiB).

Verified in production: pages, thumbnails, and `/img/web/...` streaming from R2
through the Function (the `PHOTOS` binding applied automatically from
`wrangler.jsonc` — Part A step 9 needs no manual action). `/img/full/...` correctly
404s for the `display-only` gig.

**The only Phase 0 step left is the custom domain (step 8)** — it is dashboard +
DNS work, so it needs you; there is no `wrangler pages domain` subcommand.

---

## Where the truth lives

| What | Where |
|---|---|
| Build/test commands, gotchas | `CLAUDE.md` |
| Architecture (source of truth) | `docs/design/components/00-overview.md` — §3 holds shared contracts |
| Decisions & reversals | `docs/design/ASSUMPTIONS.md` |
| Task-by-task build ledger | `.superpowers/sdd/progress.md` — ends "ALL TASKS COMPLETE" |
| Deploy runbook | `docs/DEPLOYMENT.md` |
| User-facing workflow | `README.md` |

**Golden rule still applies:** change code → update the matching design doc in the
same change.

---

## Open items, in priority order

### 1. Phase 0 — go live (blocked on the user, not on code)

**Steps 1–7 and 9 are DONE (2026-09-09).** Account, R2 bucket `pictures-elton`
(Western Europe, private), bucket-scoped R2 token + rclone remote `r2`,
`wrangler login`, Pages project `picture-book`, first deploy — all complete and
verified live. `rclone` v1.75.1 and `wrangler` 4.130.0 are installed on the host.

**Step 8 — custom domain — is the only one left, and it is yours:**
1. Pages dashboard → project `picture-book` → *Custom domains* → Add
   `pictures.sixeyed.com`. **Do this first.**
2. At name.com: CNAME, host `pictures`, answer `picture-book.pages.dev`.
3. Wait for the cert.

Until then `site.url` (`https://pictures.sixeyed.com`) is what canonical/OG
tags point at, so those references are live-but-unresolvable. Fixed by step 8.

**Pages project name changed 2026-09-08 — see ASSUMPTIONS #19.** The old name
`pictures` was taken by a third party in the interim; the project is now
**`picture-book`** and the CNAME target is `picture-book.pages.dev`. Re-check with
`dig +short <name>.pages.dev` before trusting any pages.dev name — no record means free.

**DNS is resolved as of 2026-09-04, re-verified 2026-09-08 — do not re-research this:**

- `sixeyed.com` is registered and DNS-hosted at **name.com** (NS: `ns{1..4}*.name.com`).
  It is **not** a Cloudflare zone, and it does not need to be.
- Cloudflare Pages supports custom domains on **external DNS for subdomains**: "If you
  are deploying to a subdomain, it is not necessary for your site to be a Cloudflare
  zone." Only *apex* domains require a Cloudflare zone. `pictures.sixeyed.com`
  is a subdomain, so a plain CNAME at name.com is sufficient.
- At name.com, add: **CNAME**, host `pictures`, answer `picture-book.pages.dev`.
- **Order matters:** add the custom domain in the Pages dashboard *first*, then create
  the CNAME. (DEPLOYMENT.md step 8 says this.)
- `dig CAA sixeyed.com` returns **empty** — no CAA records, so nothing blocks
  Cloudflare from issuing the certificate. This is the usual failure mode for
  external-DNS custom domains and it does not apply here.
- `pictures.sixeyed.com` currently does not resolve — the name is free.

### 2. Placeholder copy — MUST be fixed before first publish

**Resolved 2026-09-09, to the user's own direction — deployed.**

- `instagram` is now `https://www.instagram.com/elton.stoneman/`. No TODOs remain
  anywhere in `src/`.
- `intro` trimmed to `"Live-music photography."` (the "shot from the crowd and the
  pit" line was cut on request). Shows on the home page and About.
- About page reduced to the intro line plus the Instagram link. The email line was
  removed on request, so `site.email` is now **unused config** — the field is still
  in `site.js`, deliberately not deleted.
- `site.name` was left as-is.

Still never given the user's pass: nothing outstanding that is *known* placeholder,
but the wording is minimal by choice rather than reviewed prose.

### 3. Unresolved: thumbnail overlap report

The user reported thumbnails overlapping. **Never reproduced.** Measured wrapper and
`img` bounding boxes from 1366px down to 480px — no intersection, no spill; served
`site.css` was current with `must-revalidate`. Working hypothesis was a stale cached
stylesheet on the user's machine. `overflow: hidden` was added to `.thumb` as a
belt-and-braces guard (commit `4c2526d`).

**Blocked on the user.** They were asked for window width, zoom level and browser and
never answered. Do not chase this speculatively — ask whether it still happens.

### 4. Never verified (no hardware / no deploy)

- Real touch-device swipe gesture in the lightbox
- VoiceOver / screen-reader pass
- Mobile reflow (only ever eyeballed at desktop widths)
- Anything in production, because there is no production

### 5. Deferred by explicit triage — leave alone unless asked

Reserved-slug denylist, semantic date validation, `wrangler` as a devDependency,
Docker base-image tag pinning. These were consciously accepted, not overlooked.

---

## Settled decisions — do not relitigate

**Stay on Cloudflare Pages. Do not migrate to Workers + Static Assets.** Evaluated
2026-09-04 against current Cloudflare docs:

- **Cost is identical.** Static asset requests are free and unlimited on both. Pages
  Functions already bill against the same Workers free tier (100k/day). R2 is the same
  product either way. £0/month on both.
- **Effort is strictly negative.** Pages Functions' file-based routing does not exist
  on Workers, so `functions/img/[[path]].js` would need rewriting as a
  `default { fetch }` handler with its own `/img/*` routing (plus `run_worker_first`),
  which also breaks `scripts/img-function.test.mjs`. Config, `docker-compose.yml`,
  `publish.ps1` and five design docs would follow.
- **Pages is not deprecated** — Cloudflare is absorbing Pages features into Workers,
  with no forced migration deadline announced.
- **Pages is actively the better fit here**, because it supports custom domains outside
  Cloudflare zones and `sixeyed.com` is on name.com. Migrating would *cost* flexibility.

Revisit only if the user hits a Workers-only feature they want (observability/Workers
Logs is the only plausible one) or Cloudflare announces a deadline.

**The real cost risk is R2 storage, not compute.** Measured from the one real gig:
5 images = 28MB of originals but only 1.2MB of `web` renditions. At `display-only`
that is ~1,400 gigs before the 10GB R2 free tier bites. But `editorial` /`commercial`
gigs upload `full` originals too — roughly 170MB per 30-image gig, so **~58 gigs**
before it costs money. The `permission` field drives the hosting bill far more than the
platform does.

---

## Gotchas that have already bitten

These are in `CLAUDE.md` but are worth repeating because each one cost real time:

- **`build.ps1` is the only supported build.** Running Eleventy alone after deleting
  `build/` silently loses `build/thumbs/` — they are `build-images.mjs` output, not
  Eleventy's. This caused a 404 outage on the home page on 2026-07-06.
- **`wrangler pages dev` caches its asset manifest at startup**, and will serve stale
  200s that mask missing files. Restart the `web` container after any out-of-band
  change to `build/`.
- **Incremental builds are mtime-based** and will not notice a rendition *size* change.
  Delete `build/thumbs/` to force regeneration.
- **`THUMB_SIZES` is duplicated** in `scripts/build-images.mjs` and `src/_data/gigs.js`
  and must stay identical.
- **Immutable 1-year cache.** A re-edited photo republished under the same filename
  serves stale bytes for up to a year. Rename re-exported images.
- **`rclone copy` never deletes from R2.** Pruning is a manual, inspected
  `rclone sync --dry-run` after a clean build. Never automate it.
- **A stale Node v18 still sits at `/usr/local/bin/node`.** As of 2026-09-04 Homebrew's
  Node 26 is ahead of it on PATH so plain `node` works, but check `node -v` (want
  ≥ 20.9) before any host-side run. Docker is pinned to Node 26 and always safe.
- **`node --test` is run bare** from the repo root (that is what `test.ps1` does). The
  old `ERR_MODULE_NOT_FOUND` on `node --test scripts/` was a Node 24.2.0 bug and no
  longer reproduces on 26.8.1.

---

## Risks worth raising with the user

- **No git remote is configured.** `git remote -v` is empty, so the only copy of this
  work is on the local disk. `originals/` is gitignored and unbacked-up by design, but
  the code has no off-machine copy either.
- ~~Two months of dependency drift.~~ **Resolved 2026-09-04** — see ASSUMPTIONS #18.
  Baseline was verified green *before* touching anything, then everything moved to
  current: `sharp@^0.35.4`, `@11ty/eleventy@^3.1.6`, Docker base `node:26`, pwsh 7.6.5
  (Pester 6.x). Re-verified green after: 79 node + 23 Pester, thumbnails regenerated
  from scratch, page rendered and measured in the browser.
  **Still open:** `wrangler.jsonc` `compatibility_date` is `2026-06-01` and `wrangler`
  itself is un-pinned (`npx`, currently resolving 4.129.0). Decide the compat date
  deliberately at deploy time — it changes runtime semantics, so it was left alone.

---

## First moves for the next agent

1. ~~Confirm the baseline / dependency drift.~~ **Done 2026-09-04** — deps updated,
   `build` and `test` both green, site verified rendering at :8788.
2. Ask the user for: the Instagram URL, about/intro copy, and whether the thumbnail
   overlap still reproduces.
3. Then Phase 0.

Note: after any `docker compose build` or a fresh clone, the simulated R2 bucket is
empty and `/img/...` 404s until you run `pwsh scripts/dev-seed.ps1` (with the `web`
container stopped), then restart `web`. That is not a regression — it caught us on
2026-09-04.

Do not start refactoring. The build is done; it needs shipping.
