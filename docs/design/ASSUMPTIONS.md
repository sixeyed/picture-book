# Assumptions & Decisions Needing Review

Calls made while turning `high-level.md` into the component designs in
`components/`. Each one is safe to reverse now, expensive later — review before
implementation starts. Items marked **§11** resolve the spec's open decisions.

## Deviations from the spec

1. **sharp replaces ImageMagick.** Eleventy already requires Node, so image work
   uses the `sharp` npm package instead of a separate ImageMagick install — one
   toolchain, faster batch resizing, and dimension-reading for `new-gig.ps1` without
   `magick identify`. pwsh remains the CLI entry-point layer.
   *Reverse if:* you'd rather have zero npm native modules; sharp ships prebuilt
   binaries for macOS so this should be painless.

2. **`orientation` replaced by `width` + `height`** in the image schema. Orientation
   is derivable, and real dimensions enable `aspect-ratio` CSS so the grid reserves
   space before thumbnails load (no layout shift). `new-gig.ps1` fills them
   automatically (EXIF-rotation corrected), so authoring cost is unchanged.

3. **Template layout is idiomatic Eleventy**, not the spec's §3 sketch: pages are
   `src/index.njk` / `src/gig.njk` / `src/about.njk` with a single
   `src/_layouts/base.njk`; gig pages come from Eleventy pagination over a
   `src/_data/gigs.js` data file rather than per-gig templates.

4. **`full/` renditions are only uploaded for gigs whose `permission` allows
   download.** The spec only hid the download *link*; that leaves full originals
   fetchable at a guessable URL for display-only gigs. Enforcing at the pipeline
   (component 3) means the object simply doesn't exist — no auth logic needed in
   the Function. Changing a gig's permission requires a rebuild + publish.

## Spec §11 open decisions — RESOLVED by the user (2026-07-05), designs updated

5. **Generator: Eleventy v3.** Node ≥ 20, ESM.

6. **Downloads: gated per gig via `permission`** — the conditional-link design in
   §7g, plus assumption #4 above.

7. **Captions: one blurb per gig** — optional `description` field on the gig,
   rendered under the gig-page heading. No per-image captions anywhere (grid hover
   has no text overlay; lightbox footer is counter + download only).

8. **Thumbnails: in the Pages bundle.** Headroom check: Pages caps deployments at
   20,000 files; at ~30 images/gig that's ~600 gigs before this needs revisiting.

9. **Ordering: automatic.** Display order is a filename sort (≈ capture order for
   camera files), imposed by the loader (`loadGigs`) so the JSON array order never
   matters. Note: this means re-ordering requires renaming files; if hand-curated
   order is ever wanted, revert to array-order-authoritative in `gigs.mjs`.

## Operational assumptions

10. **Immutable caching means filename = content identity.** Re-editing a photo and
    republishing under the same filename will serve stale copies (edge + browser)
    for up to a year. Rule: re-exported images get a new filename (e.g.
    `P1000063-v2.jpg`). If this bites often, add a content-hash suffix to keys —
    a contained change to components 3, 4, 6.

11. **`rclone copy` never deletes from R2.** Removed images and revoked gigs leave
    orphaned (unreferenced, unlisted) objects in the bucket. Accepted at personal
    scale; a manual, inspected `rclone sync --dry-run` is the documented pruning
    path (component 7 §1). Automating deletion was deliberately avoided.

12. **Cloudflare Pages, as decided in the spec** — noting Cloudflare now steers new
    projects toward Workers + static assets. Pages remains supported and its
    Functions + R2-binding model is exactly this design; migration later would be
    mechanical (same Function code shape, same bindings).

13. **Publish is local-CLI only, no CI.** The git repo is for history, not
    deployment; `wrangler pages deploy` uploads directly. (The repo isn't `git init`ed
    yet — that's in the Phase 0 checklist.) If you later want push-to-deploy, note
    R2 upload would still be local since originals aren't in git.

14. **EXIF handling:** thumb/web renditions are metadata-stripped (removes GPS);
    `full` downloads are byte-identical originals, so whatever darktable exports
    (copyright, camera info, possibly GPS) ships to downloaders. Review your
    darktable export preset if that matters.

15. **Testing stack kept dependency-free:** `node --test` for Node code, Pester for
    the pwsh scaffolder, scripted manual passes for frontend/deploy. No vitest,
    ajv, or browser test runner. The JSON Schema file exists for editor tooling;
    runtime validation is hand-rolled to mirror it (two places to update on schema
    change — accepted for zero deps).

16. **Site copy placeholders:** `src/_data/site.js` carries the site name, intro
    line, contact email (`elton@sixeyed.com` assumed) and an Instagram URL marked
    TODO. All user-facing wording needs your pass.
