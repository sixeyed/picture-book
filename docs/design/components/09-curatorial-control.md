# Component 9 — Curatorial Control: Column Layout + Linkable Metadata

Adds editorial control the auto-layout MVP lacked (user request, 2026-07-06): explicit
per-image **column placement** with authored ordering, and **linkable artist/venue
metadata**. This is a coordinated change across components 1, 2, 4 and 5 — this doc is
the authoritative record; the affected sections of 01/02/04/05 point here.

**Files touched:**
- `schema/gig.schema.json`, `scripts/lib/gigs.mjs` (component 1)
- `scripts/new-gig.ps1` (component 2)
- `src/_data/gigs.js`, `src/gig.njk`, `src/index.njk` (component 4)
- `src/assets/site.css`, `src/assets/gallery.js` (component 5)
- plus every affected test suite; `gigs/david-kayode-goods-shed-2026.json` migrated.

---

## 1. Content-model changes (component 1)

### 1.1 Metadata — `venue` and `artists` become entities

| Field | Was | Now |
|---|---|---|
| `venue` | `"The Foundry"` (string) + top-level `location` string | `{ name, location, links? }` object; **top-level `location` removed** |
| `artists` | `["Band"]` (string[]) | `[{ name, links? }]` (array of objects) |
| `links` (new) | — | optional on venue and each artist: `[{ label, url }]`, both non-empty strings |

### 1.2 Ordering — array order is authoritative

The loader **no longer sorts images by filename**. `gig.images` order is the display
order: both the stack order within a column and the lightbox next/prev sequence. This
reverses the earlier "auto ordering" decision (ASSUMPTIONS #9).

### 1.3 Layout — `layout` + per-image `column`

- `layout` (optional): `{ "columns": <int ≥ 1>, "widths"?: <number[] length === columns, each > 0> }`.
  Default columns = 3 (exported as `DEFAULT_COLUMNS` from `gigs.mjs`); default widths equal.
- each image (optional): `"column": <int 0..columns-1>`. Validated against
  `layout.columns` (or `DEFAULT_COLUMNS` when no `layout` present).

### 1.4 Validator additions (`validateGig`)

- `venue` must be an object with non-empty `name` and `location`; `links` (if present)
  a valid link array.
- `artists` each an object with non-empty `name`; `links` (if present) valid.
- shared `validateLinks(links, path, err)`: array of `{ label, url }`, both non-empty.
- `layout` (if present): `columns` integer ≥ 1; `widths` (if present) an array of
  length `columns` with every entry a positive number.
- image `column` (if present): integer in `0..columns-1`.
- top-level `location` is gone; the plain-string field loop is now `slug/title/date/cover`.

## 2. Data layer (component 4 — `src/_data/gigs.js`)

Per gig, resolve and attach:
- `gig.layout = { columns, widths }` — `columns = layout?.columns ?? DEFAULT_COLUMNS`;
  `widths = layout?.widths ?? Array(columns).fill(1)`.
- per image: `order` (authored index), `stem`, `thumbWidth`, `thumbHeight` (as before),
  and a resolved `column`.
- `gig.columnGroups` — array of `columns` arrays; each image pushed into its column in
  authored order.
- `gig.coverImage` (as before).

**Fallback placement** for an image whose `column` is missing/out-of-range: portraits
(`height > width`) alternate into the outer columns (`0`, then `columns-1`, …);
landscapes go to the centre column (`floor((columns-1)/2)`). This is the same heuristic
`new-gig.ps1` seeds, so hand-placement is optional — a fresh gig already looks right.

## 3. Templates (component 4)

- `src/gig.njk` heading: render each artist `name` followed by its links as
  `<a class="chip" href>` chips (` · ` between artists), then the venue `name` + its
  link chips, then `venue.location` and the date. `a.links` / `venue.links` may be
  absent — Nunjucks `for` over `undefined` is a no-op, so no guard needed.
- `src/gig.njk` gallery: the `.columns` / `.col` / `a.thumb[data-order]` markup — see
  overview §3.6 (the authoritative markup contract).
- `src/index.njk`: home card uses `{{ gig.venue.name }}` (venue is now an object).

## 4. Frontend (component 5)

- `site.css`: `.columns` is `display:flex; gap; align-items:flex-start`; each `.col` is
  `display:flex; flex-direction:column; gap; min-width:0` with its flex weight set
  inline from `layout.widths`. Below 700 px, `.columns` becomes a single vertical stack
  (`flex-direction:column`, `.col { flex:none; width:100% }`). Flexbox columns are used
  deliberately instead of masonry — robust, gapless, no balancing algorithm.
- `.meta .chip`: small pill link (rounded border, dim → accent on hover).
- `gallery.js`: bind to `.columns` (not `ul.grid`), gather `a.thumb` across all columns
  and **sort by `data-order`** before building the lightbox `items` — so next/prev
  follows authored order regardless of the column-grouped DOM. Everything else unchanged.

## 5. Scaffolder (component 2 — `new-gig.ps1`)

Output shape updated: `venue = { name, location, links: [] }`;
`artists = [{ name, links: [] }]`; `layout = { columns: 3 }`; each image gets a
`column` seeded by the orientation heuristic (portraits → outer alternating,
landscapes → centre). `column` values must be **integers** — cast
`[int][math]::Floor(...)` (PowerShell's `[math]::Floor` returns a double, which would
serialise as `1.0`). Uses `ConvertTo-Json -Depth 6` (deeper nesting now).

## 6. Known tradeoffs

- **Mobile order:** with column-grouped DOM, the <700 px single-column view shows shots
  column-by-column (each column's authored order preserved), not the flat authored
  sequence. Accepted; a JS reflow could give flat mobile order later if wanted.
- **Hero size** comes from column `widths`, not a per-image size field. One shot larger
  than its column-mates is not expressible — deliberate YAGNI; add a per-image span/size
  later if a gig needs it.
- Cross-column spanning is not supported (flexbox columns are independent).

## 6a. Layout refinements (2026-07-07, after first review)

- **Thumbnails 600 → 1600 px long edge** (`build-images.mjs`, `_data/gigs.js` must
  match). A portrait's *short* edge fills a column, so at 600 px it was ~340 px and
  upscaled/fuzzy on hi-DPI. 1600 keeps portraits crisp at 2x. Incremental builds are
  mtime-based and won't notice an edge change — delete `build/thumbs/` to force regen.
- **Visible border + wider gutter:** `.thumb img` gets `1px solid rgb(255 255 255 /
  .32)` (accent on hover); `--gap` raised to 16 px. Dark stage shots with only a faint
  border and a 10 px gap read as "overlapping" — there is no geometric overlap (flexbox
  columns cannot overlap siblings; verified by measuring bounding boxes).
- **Balancing three stacked landscapes against the flanking portraits** is done with
  column `widths`, not per-image sizing. For this gig `[1, 1.07, 1]` lands all three
  columns within ~45 px of each other (portraits scaled slightly down so they no longer
  tower over the centre stack). The balance point is gig-specific — a function of the
  images' aspect ratios — so it's a hand-tuned `widths`, not an automatic rule.

## 7. Test coverage (all green: 79 node tests + 23 Pester)

- `gigs.test.mjs`: venue/artist/links/layout/column validation; **authored-order**
  loader test (filename-scrambled input returns in authored order).
- `site.test.mjs`: `.columns` container with N `.col` blocks; `data-order` present;
  artist + venue link chips render with correct hrefs; display-only gig has no `.chip`
  and no `data-full`; venue.name on the home card; double-escape regression retained.
- `build-images.test.mjs`: fixtures migrated to the new shape (pipeline logic unchanged).
- `new-gig.tests.ps1`: venue/artist object output, empty `links`, no top-level
  `location`, 3-column layout, orientation-seeded columns, integer (not float) columns.

## 8. Acceptance

- [x] `node --test` and `Invoke-Pester scripts/` both green.
- [x] Real gig (`david-kayode-goods-shed-2026`) renders portraits flanking a wider
      centre landscape stack; artist/venue chips link out; lightbox cycles in authored
      order — verified in-browser against the Docker stack.
