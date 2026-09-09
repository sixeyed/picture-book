# Component Designs — Overview & Shared Contracts

Companion to [`../high-level.md`](../high-level.md). That document is the spec; these
documents are the component designs, written so an agent with zero prior context can
implement any single component against fixed contracts. **Read this file first — every
other component doc assumes it.**

Decisions on the spec's open questions (§11) and deviations from the spec are recorded
in [`../ASSUMPTIONS.md`](../ASSUMPTIONS.md).

---

## 1. Component map

| # | Doc | Component | Depends on |
|---|---|---|---|
| 1 | [01-content-model.md](01-content-model.md) | Gig JSON schema + loader/validator (`schema/gig.schema.json`, `scripts/lib/gigs.mjs`) | — |
| 2 | [02-new-gig-cli.md](02-new-gig-cli.md) | `scripts/new-gig.ps1` scaffolder | 1 |
| 3 | [03-rendition-pipeline.md](03-rendition-pipeline.md) | `scripts/build-images.mjs` + `scripts/build.ps1` | 1 |
| 4 | [04-site-generator.md](04-site-generator.md) | Eleventy config, data layer, templates | 1 |
| 5 | [05-frontend.md](05-frontend.md) | `src/assets/site.css` + `src/assets/gallery.js` | 4 (markup contract) |
| 6 | [06-image-function.md](06-image-function.md) | `functions/img/[[path]].js` + `wrangler.jsonc` | — |
| 7 | [07-publish-pipeline.md](07-publish-pipeline.md) | `scripts/publish.ps1`, `.gitignore`, one-time Cloudflare setup | 3, 4, 6 |
| 8 | [08-docker-local.md](08-docker-local.md) | Docker local stack: `Dockerfile`, `docker-compose.yml`, `scripts/test.ps1`, `scripts/dev-seed.ps1` | 3, 4, 6 |
| 9 | [09-curatorial-control.md](09-curatorial-control.md) | Curatorial control: explicit column layout + linkable artist/venue metadata (a change across 1, 2, 4, 5) | 1, 2, 4, 5 |

Build order for agents: **1 → (2, 3, 4, 6 in parallel) → 5 → 7 → 8.**
Components 2, 3, 4 only share the content model; 6 shares only the R2 key scheme.

Each component doc contains: files, interfaces (consumes/produces), behaviour,
reference code for anything non-obvious, a test plan with concrete cases, and
acceptance criteria. Implementers should work test-first from the listed cases.

---

## 2. Repository layout (authoritative)

```
picture-book/
├── docs/design/                  # this design set
├── schema/
│   └── gig.schema.json           # JSON Schema for gig files (editor tooling + validation)
├── gigs/                         # one JSON file per gig — committed
│   └── <slug>.json
├── originals/                    # full-res exports — GITIGNORED
│   └── <slug>/P1000063.jpg
├── src/
│   ├── _data/gigs.js             # Eleventy global data: loads + sorts gigs/
│   ├── _layouts/base.njk
│   ├── index.njk                 # home page
│   ├── gig.njk                   # paginated template → one page per gig
│   ├── about.njk
│   └── assets/
│       ├── site.css
│       └── gallery.js
├── functions/
│   └── img/[[path]].js           # Pages Function: streams R2 objects
├── scripts/
│   ├── new-gig.ps1
│   ├── build.ps1
│   ├── publish.ps1
│   ├── build-images.mjs          # rendition pipeline (sharp)
│   └── lib/gigs.mjs              # shared loader/validator
├── build/                        # generated output — GITIGNORED
├── .r2-stage/                    # web/ + full/ renditions awaiting upload — GITIGNORED
├── eleventy.config.mjs
├── package.json
├── wrangler.jsonc
└── .gitignore
```

Differences from the spec's §3 sketch: pages live at `src/*.njk` with a single
`_layouts/base.njk` (idiomatic Eleventy — `index`/`gig`/`about` are pages, not
layouts); image work is a Node script using sharp, not ImageMagick; a `schema/`
directory holds the JSON Schema. See ASSUMPTIONS.md #1–#3.

---

## 3. Shared contracts

Everything below is fixed. A component that needs to deviate must update this file
and every doc that references the contract.

### 3.1 Toolchain

- Node **≥ 20.9** (`sharp@^0.35` floor; built and tested on 26), ESM everywhere (`.mjs` / `"type": "module"`).
- PowerShell 7 (`pwsh`) for CLI entry points — the user's shell on macOS.
- npm dependencies: `@11ty/eleventy@^3.1`, `sharp@^0.35`. Dev-only: none required.
- External CLIs (publish only): `rclone` (remote named `r2`), `wrangler` (logged in).

`package.json` (owned by component 4, consumed by all):

```json
{
  "name": "picture-book",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.9" },
  "scripts": {
    "build:site": "eleventy",
    "build:images": "node scripts/build-images.mjs",
    "dev": "wrangler pages dev build"
  },
  "dependencies": {
    "@11ty/eleventy": "^3.1.6",
    "sharp": "^0.35.4"
  }
}
```

### 3.2 URL scheme (public site)

| URL | Served by | Notes |
|---|---|---|
| `/` | static (Eleventy) | home: gig cards, newest first |
| `/<slug>/` | static | gig gallery page |
| `/about/` | static | bio + contact |
| `/thumbs/<slug>/<file>` | static (Pages bundle) | 600 px thumbnails |
| `/img/web/<slug>/<file>` | Pages Function → R2 | 2048 px lightbox rendition |
| `/img/full/<slug>/<file>` | Pages Function → R2 | original; only exists when the gig's `permission` allows download |
| `/<slug>/#<stem>` | client-side | deep link opening the lightbox on image whose filename stem is `<stem>` (e.g. `#P1000063`) |

### 3.3 R2 key scheme (bucket `pictures-elton`, binding `PHOTOS`)

```
web/<slug>/<file>     e.g. web/summer-festival-2026/P1000063.jpg
full/<slug>/<file>    only for gigs where permission != "display-only"
```

The Function maps `/img/<key>` → R2 object `<key>` and rejects any key not starting
with `web/` or `full/`.

### 3.4 Renditions

| Rendition | Long edge | JPEG quality | Metadata | Output path |
|---|---|---|---|---|
| `thumb` | 800 **and** 1600 px | 80 | stripped | `build/thumbs/<slug>/<stem>-<edge>.jpg` |
| `web` | 2048 px | 85 | stripped | `.r2-stage/web/<slug>/<file>` |

Two thumbnail sizes are generated per image for a responsive `srcset` (small/1x
vs hi-DPI/2x); the grid `<img>` lists both with `w` descriptors + a `sizes` hint,
so phones fetch the 800 and retina desktops the 1600. See 09 §6a.
| `full` | original bytes, untouched copy | — | as exported | `.r2-stage/full/<slug>/<file>` |

Never upscale (if the original's long edge is smaller than the target, copy at
original size). `full` is staged **only** when the gig's `permission` is not
`display-only`. Filenames are preserved exactly — an image's public identity is
`<slug>/<file>`, and cache headers are immutable, so a re-edited photo must be given
a new filename (ASSUMPTIONS.md #7). Immutability is set in two places: the Function
for `/img/...` (component 06) and `src/_headers` for `/thumbs/...`, copied to the
build root by an Eleventy passthrough. `/assets/*` is deliberately excluded.

### 3.5 Gig content model (summary — full definition in 01, feature spec in 09)

```json
{
  "slug": "summer-festival-2026",
  "title": "Summer Festival",
  "date": "2026-06-21",
  "venue": { "name": "The Foundry", "location": "Sheffield, UK",
             "links": [{ "label": "Website", "url": "https://…" }] },
  "artists": [
    { "name": "The Example Band",
      "links": [{ "label": "Instagram", "url": "https://…" }] }
  ],
  "permission": "display-only",
  "description": "Headline set under the big top — shot from the pit.",
  "cover": "P1000063.jpg",
  "layout": { "columns": 3, "widths": [1, 1.4, 1] },
  "images": [
    { "file": "P1000063.jpg", "width": 6000, "height": 4000, "column": 1 }
  ]
}
```

- `venue` is an **object** (`name`, `location`, optional `links`); `artists` is an
  **array of objects** (`name`, optional `links`). `links` = `[{ label, url }]`.
  There is no top-level `location`. (Curatorial-control feature — see 09.)
- **Array order IS display order** — both the stack order within a column and the
  lightbox next/prev sequence. The loader no longer sorts by filename (reverses the
  old "auto ordering" call — ASSUMPTIONS.md #9).
- `layout` (optional) = `{ columns, widths? }`; each image may carry an optional
  `column` (0-based). Both default via the data layer (columns = 3; portraits flank
  the outer columns, landscapes stack in the centre). Full definition in 09.
- `description` — optional per-gig blurb (the only caption text; no per-image captions).
- `width`/`height` are the original's pixel dimensions (enables `aspect-ratio` CSS).
- `permission` ∈ `display-only | editorial | commercial`; anything other than
  `display-only` shows the full-res download link and stages `full/` to R2.

### 3.6 Gallery markup contract (produced by 4, consumed by 5)

`gig.njk` renders the gallery as a row of columns. Each image is placed into its
assigned column; within a column, images stack in authored order:

```html
<div class="columns" data-download="{{ 'true' if gig.permission != 'display-only' else 'false' }}">
  {% for col in gig.columnGroups %}
  <div class="col" style="flex: {{ gig.layout.widths[loop.index0] }}">
    {% for img in col %}
    <a class="thumb" href="/img/web/{{ gig.slug }}/{{ img.file }}"
       data-order="{{ img.order }}"
       data-stem="{{ img.stem }}"
       {% if gig.permission != "display-only" %}data-full="/img/full/{{ gig.slug }}/{{ img.file }}"{% endif %}
       style="aspect-ratio: {{ img.width }} / {{ img.height }}">
      <img src="/thumbs/{{ gig.slug }}/{{ img.file }}" alt="{{ gig.title }}"
           width="{{ img.thumbWidth }}" height="{{ img.thumbHeight }}" loading="lazy" decoding="async">
    </a>
    {% endfor %}
  </div>
  {% endfor %}
</div>
```

- `data-full` is emitted only when `gig.permission != "display-only"` — a
  display-only gig's markup must not leak the full-res URL shape at all.
- `data-order` is the image's authored index in the flat `images` array.
  `gallery.js` binds to `.columns`, gathers all `a.thumb`, and **sorts them by
  `data-order`** so the lightbox next/prev sequence follows authored order, not the
  column-grouped DOM order.
- With JS disabled the anchors still open the `web` rendition directly.
- `img.order`, `img.stem`, `img.thumbWidth`, `img.thumbHeight`, `gig.columnGroups`
  and `gig.layout` (resolved `{ columns, widths }`) are computed by the data layer
  (component 4). Full definition of the column engine in 09.

### 3.7 Build & publish flow

```
new-gig.ps1   : exports folder → originals/<slug>/ + gigs/<slug>.json stub
build.ps1     : validate gigs → build-images.mjs (thumbs→build/, web+full→.r2-stage/)
                → eleventy (HTML→build/)
publish.ps1   : build.ps1 → rclone copy .r2-stage → r2:pictures-elton
                → wrangler pages deploy build
```

`build-images.mjs` runs before Eleventy and writes directly into `build/thumbs/`;
Eleventy does not clean its output directory, so both coexist. Both steps are
incremental (skip work whose output is newer than its inputs).

**`build.ps1` is the only supported way to build.** Running Eleventy alone after
deleting `build/` silently loses `build/thumbs/` (Eleventy does not produce it) —
pages then 404 their thumbnails until the next full build. This bit us once
(2026-07-06); if `build/` is ever hand-cleaned, rerun `build.ps1`, not `npx
@11ty/eleventy`.

---

## 4. Phases

Component set above covers the spec's **Phase 1 + Phase 2** in full. Phase 3 items
included cheaply where marked: deep links (§3.2 hash scheme, component 5) and Open
Graph tags (component 4). S/M/L grid toggle and next-image prefetch are specced as
optional extensions inside component 5 — implement last.

Phase 0 (Cloudflare account setup) is a manual checklist in component 7.
