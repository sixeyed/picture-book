---
name: insta
description: Use when the user wants to post a gig's photos to Instagram, asks for "insta" versions, Instagram-sized crops, or which shots from a gig would suit Instagram.
---

# Instagram prep for a gig

## Overview

Posting is manual (no API). The job is to hand the user a folder of feed-ready
JPEGs, ranked by fit, plus a caption — they pick 1–3 and post from their phone.

## Steps

1. **Export** (gig must exist in `gigs/` with originals present):
   ```bash
   export PATH=/opt/homebrew/bin:$PATH
   node scripts/insta-export.mjs <slug>
   ```
   Writes `insta/<slug>/` (gitignored): one 1080-wide JPEG per photo, `index.json`
   (ranked, with `crop: true/false`) and `caption.txt`.

2. **Show the user the ranking** as a short table: file, size, cropped or not, and
   a few words on what's in the frame (Read the exports — they are small). Rank
   order is aspect fit: 4:5 first, near-square, then landscapes, panoramas last.

3. **Check every cropped export by eye.** Crops are attention-positioned and
   usually keep the performer, but a crowd or bright projection can pull the crop
   away. If a crop is wrong, say so — the user can pick a different frame.

4. **Caption:** show `caption.txt` (artist · venue · date, link to the gig page,
   standing hashtags). Apply any wording the user asks for and rewrite the file.

5. **Hand over:** `open insta/<slug>` so the folder is in Finder; the user
   AirDrops the chosen files and pastes the caption.

## Rules

- Never re-crop by hand or pick "the best" for the user beyond the ranking; they
  choose the 1–3 to post.
- Exports come from `originals/`, never from `build/` thumbs.
- Sizes are fixed by `insta-export.mjs` (4:5 crop for tall portraits, resize-only
  inside 4:5–1.91:1, 1.91:1 crop for panoramas); don't invent other sizes.
- Nothing here publishes anywhere. There is no Instagram token in this repo.
