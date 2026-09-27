---
name: new-gig
description: Use when the user says there is a new gig (or several) to build out, mentions gig photos in iCloud (gig-pictures), names a folder under originals/, or asks to add, publish or fix a gig's JSON, cover, layout, links, time or ordering in this picture-book repo.
---

# New gig: iCloud gig-pictures/ → live on pictures.sixeyed.com

## Overview

**Input is iCloud Drive** (the standard workflow since 2026-09-27):

```
~/Library/Mobile Documents/com~apple~CloudDocs/gig-pictures/<yyyy-mm-dd>_<name>/darktable_exported/*.jpg
```

The folder name is a hint only: its date can be a typo (`2029-09-26` for a
2026 gig), so date the gig from EXIF. Ask for what the photos can't tell you:
venue, how it was billed, permission (default `display-only`, as at the other
gigs so far). The job is: scaffold into `originals/<slug>/`, write
`gigs/<slug>.json`, lay the photos out, verify in the running stack, publish,
commit. Facts come from EXIF and verified URLs, not from guesses.

Slug: `<artist>-<venue>-<yymm>`, e.g. `london-saxophonic-goods-shed-2609`.

## Step 1 — Scaffold from iCloud with new-gig.ps1

```bash
export PATH=/opt/homebrew/bin:$PATH
SRC=~/Library/Mobile\ Documents/com~apple~CloudDocs/gig-pictures/<folder>/darktable_exported
python3 .claude/skills/new-gig/exif-times.py "$SRC"      # real date + times first
pwsh -NoProfile ./scripts/new-gig.ps1 -Source "$SRC" -Slug <slug> -Title '<title>' \
  -Date <yyyy-mm-dd> -Venue '<venue>' -Location '<town>, UK' -Artists '<artist>'
```

This copies the JPEGs and writes a JSON stub with rotation-corrected dimensions.
Then rewrite the JSON by hand (links, cover, layout, compact one-line images).

**Never run `new-gig.ps1` on an existing `originals/<slug>/`**: it refuses, and
`-Force` **deletes the folder** before copying. If the originals are already
there, hand-write the JSON instead:

```bash
node scripts/lib/read-dimensions.mjs originals/<slug>     # rotation-corrected w×h
python3 .claude/skills/new-gig/exif-times.py originals/<slug>   # camera-clock times
```

## Step 2 — Date and time come from EXIF, never mdls

`mdls` / Finder dates are **UTC**: an hour wrong under BST. Use `exif-times.py`
(`DateTimeOriginal`, the camera's local clock). `date` = that day. Set
`"time": "HH:MM"` (first frame) **whenever another gig shares the date** — a
festival day. Without it same-day gigs sort alphabetically and the home page and
Previous/Next nav run in the wrong order. Time is never displayed.

## Step 3 — Look at every photo before laying out

```bash
S=<scratchpad>/prev; mkdir -p $S
for f in originals/<slug>/*.jpg; do sips -Z 700 "$f" --out $S/$(basename $f) >/dev/null; done
```
Read each preview. Decide: **cover (landscape — a portrait cover skews the home
row)**, lightbox order (array order; chronological by default), and columns.

## Step 4 — Column maths

Column height ∝ Σ(h/w of its images) × column width, so **widths ∝ 1 / Σ(h/w)**.
Normalise so one column = 1. Put the smallest Σ in the centre if you want it wide.
When 3 columns can't balance (one panorama, two portraits; mostly landscapes), use
`"columns": 2`. Verify heights in the browser — within ~20px is good.

## Step 5 — Links: verified or omitted

- Reuse venue links from an existing gig at the same venue.
- Artist links only if `curl -sL <url> | grep -o '<title>[^<]*'` shows the artist.
- **Instagram returns 200 for any handle — never include one you did not verify.**
- Can't verify? Leave `links: []` and tell the user, don't guess.
- Title/artist name as the artist styles it (`afromerm`, `Širom`).

## Step 6 — Build, seed, restart, measure

```bash
docker compose run --rm build
docker compose run --rm shell pwsh scripts/dev-seed.ps1
docker compose restart web      # wrangler caches its asset manifest at startup
```
Then in Chrome on :8788: thumbs load, column heights, home order, nav both ways.

**Moving a photo between gigs:** `mv` the original, then delete its stale
`build/thumbs/<old-slug>/<stem>-*.jpg` and `.r2-stage/web/<old-slug>/<file>` —
`rclone copy` never deletes, so a stray file would upload.

## Step 7 — Publish, verify live, commit

```bash
pwsh -NoProfile ./scripts/publish.ps1 -SkipBuild -DryRun   # only new renditions listed?
pwsh -NoProfile ./scripts/publish.ps1 -SkipBuild
```
Check live: gig page 200, each `/img/web/<slug>/<file>` 200, `/img/full/...` 404
for display-only. Commit `content: add <title> at <venue>`; push `origin`, then
`git push github main` (if it hangs on osxkeychain:
`git -c credential.helper= -c credential.helper='!gh auth git-credential' push github main`).

## Report to the user

What they must eyeball: links found/omitted, cover choices, titles, `time` values.

## Common mistakes

| Mistake | Fix |
|---|---|
| `new-gig.ps1 -Force` on existing originals | Deletes them. Hand-write the JSON. |
| Times from `mdls` | UTC. Use `exif-times.py`. |
| Same-date gigs, no `time` | Alphabetical order on home + nav. Set `time`. |
| Unverified Bandcamp/Instagram link | User will strike it. Verify or omit. |
| Portrait cover | Home cards are 3:2 letterboxed; still pick landscape. |
| Widths ∝ Σ(h/w) | Inverted — taller stack needs a *narrower* column. |
| Skipped `docker compose restart web` | Stale manifest → 404s / old pages. |
