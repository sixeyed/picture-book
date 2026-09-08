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

9. **Ordering: manual (REVERSED 2026-07-06).** Originally auto (filename sort). The
   curatorial-control feature made the **JSON array order authoritative** — it is both
   the stack order within a column and the lightbox next/prev sequence; the loader no
   longer sorts. `new-gig.ps1` still seeds the array in filename order as a starting
   point. See `components/09-curatorial-control.md`.

9a. **Layout & metadata (curatorial control, 2026-07-06).** Gigs gained an explicit
    column layout (`layout` + per-image `column`, flexbox columns, portraits-flank /
    landscapes-centre default) and linkable entities (`venue` and `artists` are now
    objects with optional `links`; top-level `location` folded into `venue`). Full
    design and tradeoffs (mobile order, hero-via-widths, no cross-column span) in
    `components/09-curatorial-control.md`.

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

16. **Docker local stack (user requirement, 2026-07-05):** the containers run the
    same pwsh entry-point scripts as the host (image = Node 26 + pwsh + Pester;
    repo bind-mounted; `node_modules` and wrangler local-R2 state in named
    volumes). `wrangler pages dev` inside the container serves the full stack —
    static site + image Function + simulated R2 — on `localhost:8788`. Publishing
    stays host-side (needs `wrangler login`/rclone credentials). See
    `components/08-docker-local.md`.

17. **Site copy placeholders:** `src/_data/site.js` carries the site name, intro
    line, contact email (`elton@sixeyed.com` assumed) and an Instagram URL marked
    TODO. All user-facing wording needs your pass.

18. **Dependency refresh (2026-09-04):** after ~2 months dormant, everything was
    moved to current: `sharp@^0.33.0` → `^0.35.4`, `@11ty/eleventy@^3.0.0` →
    `^3.1.6` (3.1.6 *is* latest stable — 4.0 is alpha only), Docker base
    `node:24-bookworm-slim` → `node:26-bookworm-slim`, `PWSH_VERSION` 7.5.4 →
    7.6.5 (which pulls Pester 6.x instead of 5.x). `engines.node` raised to
    `>=20.9` to match sharp 0.35's floor. Baseline was green *before* the update
    and green after: 79 node + 23 Pester. Thumbnails were regenerated from
    scratch (`rm -rf build/thumbs`) and verified — correct long edges, EXIF still
    stripped, page renders with no overlap at 2560px.

    Deliberately **not** changed: `wrangler` stays un-pinned via `npx` (assumption
    in the deferred pile), and `wrangler.jsonc` `compatibility_date` stays at
    `2026-06-01` — it is a runtime-semantics flag, not a dependency, so bumping it
    is a separate, deliberate decision to make at deploy time.

19. **Pages project renamed `pictures` → `picture-book` (2026-09-08):** the original
    name was never claimed, and in the interim someone else took
    `pictures.pages.dev` — it now has a live DNS record and serves an unrelated
    third-party page. Two consequences: `wrangler pages project create pictures`
    would be rejected (the `*.pages.dev` label is globally unique), and the
    documented CNAME target would have pointed `pictures.elton.stoneman.io` at a
    stranger's site. Renamed in `wrangler.jsonc`, `publish.ps1` and five design
    docs. **Unchanged:** the R2 bucket is still `pictures-elton` (bucket names are
    per-account, no collision) and the custom domain is still
    `pictures.elton.stoneman.io` — only the Pages project and its CNAME target moved.

    Method worth reusing: `*.pages.dev` is **not** wildcard DNS, so
    `dig +short <name>.pages.dev` returning nothing means the name is free.
    Verified free at the time of choosing: `picture-book`, `elton-pictures`,
    `stoneman-pictures`, `sixeyed-pictures`, `eltonstoneman`.
