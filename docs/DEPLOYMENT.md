# Deploying the Gallery

Everything up to now runs **locally** (build + preview in Docker). This guide covers
the one-time Cloudflare setup and the repeatable publish workflow that puts the site
live at **`pictures.elton.stoneman.io`**.

## How it deploys (the model)

| Piece | Where it lives | How it gets there |
|---|---|---|
| HTML + CSS + JS + **thumbnails** | Cloudflare **Pages** (static bundle) | `wrangler pages deploy build` |
| `web` (2048px) + `full` originals | Cloudflare **R2** (private bucket `pictures-elton`) | `rclone copy .r2-stage r2:pictures-elton` |
| Image delivery | Pages **Function** (`/img/...`) streams R2 via the `PHOTOS` binding | deployed with the site |

The bucket stays **fully private** — the only public hostname is the Pages domain.
Deploys are **direct uploads** with `wrangler` (no git integration needed; git is just
history). Runs at **£0/month** within Cloudflare's free tiers at personal scale.

`originals/` never leaves your machine + R2, and is never committed to git.

---

## Prerequisites (install once, on your Mac — not in Docker)

Publishing runs host-side because it needs your Cloudflare credentials. You need two
CLIs the local Docker workflow didn't:

```bash
brew install rclone          # syncs renditions to R2
npm install -g wrangler      # deploys to Pages   (or use `npx wrangler ...`)
```

`node` and `pwsh` you already have. (Heads-up: your host `node` is a stale v18 that
shadows Homebrew's Node 24 — see Troubleshooting. It doesn't matter if you build in
Docker as recommended below.)

---

## Part A — One-time Cloudflare setup

Do these once. Later publishes are just Part B.

### 1. Cloudflare account
Sign up (free) at dash.cloudflare.com. Note your **Account ID** (dashboard → right
sidebar, or R2 overview) — you'll need it for rclone.

### 2. Create the private R2 bucket
Dashboard → **R2** → *Create bucket* → name it **`pictures-elton`**.
Leave it **private**: no public access, no custom domain, no `r2.dev` URL.

### 3. Create an R2 API token (for rclone)
R2 → *Manage R2 API Tokens* → *Create API token*:
- Permissions: **Object Read & Write**
- Scope: **just the `pictures-elton` bucket**

Copy the **Access Key ID** and **Secret Access Key** (shown once). Your S3 endpoint is
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

### 4. Configure the rclone remote (must be named `r2`)
```bash
rclone config
```
Answer: `n` (new remote) → name **`r2`** → storage **`s3`** → provider **`Cloudflare`**
→ paste the Access Key ID + Secret → region `auto` → endpoint
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com` → accept defaults for the rest.

Verify:
```bash
rclone lsd r2:                # should list: pictures-elton
```

### 5. Log in wrangler
```bash
wrangler login               # opens a browser to authorise
```

### 6. Create the Pages project (direct-upload)
```bash
wrangler pages project create pictures --production-branch main
```
The project **name must be `pictures`** — that's what `wrangler.jsonc` and `publish.ps1`
reference. The `PHOTOS` → `pictures-elton` R2 binding is declared in `wrangler.jsonc` and
applied on deploy.

### 7. First deploy
From the repo root, build then publish (see Part B for the flags):
```bash
docker compose run --rm build          # produces build/ and .r2-stage/
./scripts/publish.ps1 -SkipBuild       # pushes R2 + deploys the site
```
The site is now live at `https://pictures.pages.dev`.

### 8. Add the custom domain (order matters)
1. Pages dashboard → project **pictures** → *Custom domains* → **Add**
   `pictures.elton.stoneman.io`. Do this **first**.
2. At your DNS host for `stoneman.io`, add a **CNAME**:
   `pictures.elton` → `pictures.pages.dev`.
3. Wait for the TLS certificate to issue (minutes). Then the site answers at
   `https://pictures.elton.stoneman.io`.

### 9. Confirm the R2 binding
Pages dashboard → project **pictures** → *Settings* → *Bindings*: confirm
`PHOTOS → pictures-elton` is present. If it isn't, add it manually (R2 bucket binding,
variable name `PHOTOS`, bucket `pictures-elton`) and redeploy.

**Setup done.** From here, publishing a gig is Part B.

---

## Part B — Publishing a gig (the repeatable workflow)

```bash
# 1. Scaffold from your darktable exports (fills dimensions + a starter column layout)
pwsh ./scripts/new-gig.ps1 -Source ~/Pictures/exports/<folder> -Slug <slug> `
     -Title '<Artist>' -Date 2026-07-03 -Venue '<Venue>' -Location '<Town, UK>' -Artists '<Artist>'

# 2. Edit gigs/<slug>.json — add artist/venue links, tweak image order/columns/widths,
#    set permission (display-only | editorial | commercial), write a description.

# 3. Preview locally (optional but recommended)
docker compose run --rm build
docker compose run --rm shell pwsh scripts/dev-seed.ps1   # load images into local R2
docker compose up web                                     # http://localhost:8788

# 4. Publish
docker compose run --rm build          # if you didn't already build in step 3
./scripts/publish.ps1 -SkipBuild       # → live at pictures.elton.stoneman.io
```

Commit `gigs/<slug>.json` to git when you're happy (code + content history; the images
themselves stay out of git).

---

## What `publish.ps1` actually does

1. **Preflight** — fails fast if `rclone`, `wrangler`, or `node` is missing, or the
   `r2` remote isn't configured.
2. **Build** (unless `-SkipBuild`) — runs `build.ps1` (renditions + Eleventy).
3. **Push to R2** — `rclone copy .r2-stage r2:pictures-elton --checksum`. Only changed
   files upload; **it never deletes** remote objects (safe, but see the note below).
   Thumbnails are *not* pushed — they ride in the Pages bundle.
4. **Deploy** — `wrangler pages deploy build --project-name pictures`.

Flags:
- **`-SkipBuild`** — deploy what's already in `build/` + `.r2-stage/` (use after a
  `docker compose run --rm build`). **Recommended**, so the build uses Docker's Node 24
  rather than your host's stale v18.
- **`-DryRun`** — show what rclone *would* upload and skip the deploy entirely.

> Run `publish.ps1` from the repo root. It pins itself to the repo with
> `Push-Location`, but running it from elsewhere is still best avoided.

---

## Verify & costs

- `curl -I https://pictures.elton.stoneman.io/img/web/<slug>/<file>` → `200` with
  `cache-control: public, max-age=31536000, immutable`; a second request shows
  `cf-cache-status: HIT`.
- A display-only gig's `/img/full/...` returns **404** (originals aren't uploaded for
  those) — that's correct.
- Cloudflare dashboards (Pages + R2) show usage comfortably inside the free tiers.

---

## Two things to know

- **Re-editing a photo:** cache headers are immutable (1 year). Republishing changed
  bytes under the **same filename** serves stale copies. Rule: give a re-exported image
  a **new filename** (e.g. `P1000063-v2.jpg`).
- **Removing images / downgrading a gig to `display-only`:** `rclone copy` never deletes
  from R2, so the old `web/`/`full/` objects linger (unreferenced, but still fetchable
  for `full/`). To actually prune them, after a clean build run
  `rclone sync .r2-stage r2:pictures-elton --dry-run`, inspect the deletions, then run it
  for real. Deliberately manual — `sync` can delete, so never automate it.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `rclone remote 'r2' is not configured` | Part A step 4; remote must be named exactly `r2`. |
| Images 404 in production but site loads | R2 binding missing — Part A step 9; redeploy. |
| `sharp`/Eleventy errors during a **host** build | Host `node` is v18. Build in Docker (`docker compose run --rm build`) and publish with `-SkipBuild`, or fix your PATH so Homebrew's Node 24 wins (`/opt/homebrew/bin` before `/usr/local/bin`). |
| Custom domain won't resolve | Add the domain in the Pages dashboard **before** the DNS CNAME; wait for the cert. |
| Thumbnails stale after a rebuild locally | `wrangler pages dev` caches its asset manifest — restart the `web` container. (Production is unaffected.) |

---

## Local preview reference (recap)

```bash
docker compose run --rm build          # renditions + HTML → build/
docker compose run --rm shell pwsh scripts/dev-seed.ps1   # seed local R2
docker compose up web                  # full stack incl. the image Function → :8788
docker compose run --rm test           # the whole test suite (node + Pester)
```
