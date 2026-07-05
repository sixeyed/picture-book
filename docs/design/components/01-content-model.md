# Component 1 — Content Model: Gig Schema + Loader

The single source of truth for site content: one JSON file per gig, a JSON Schema
that documents and validates it, and a shared Node module that every other tool uses
to load gigs consistently.

**Files:**
- Create: `schema/gig.schema.json`
- Create: `scripts/lib/gigs.mjs`
- Create: `gigs/.gitkeep` (directory must exist in git before the first gig)

**Interfaces:**
- Consumes: nothing (foundation component).
- Produces:
  - `loadGigs(dir)` → `Promise<Gig[]>` — parsed, validated, sorted newest-first.
  - `validateGig(gig, fileName)` → `string[]` — list of human-readable problems, empty if valid.
  - `gig.schema.json` — referenced by gig files via `$schema` for editor autocomplete.

---

## 1. Field semantics

| Field | Type | Required | Rules |
|---|---|---|---|
| `slug` | string | yes | `^[a-z0-9]+(-[a-z0-9]+)*$`; must equal the file name (`gigs/<slug>.json`); becomes the URL path and R2 prefix |
| `title` | string | yes | non-empty; display name |
| `date` | string | yes | `YYYY-MM-DD`; used for sorting (desc) and display |
| `venue` | string | yes | non-empty |
| `location` | string | yes | e.g. `"Sheffield, UK"` |
| `artists` | string[] | yes | at least one entry |
| `permission` | string | yes | one of `display-only`, `editorial`, `commercial`; anything except `display-only` enables the full-res download link and full/ upload |
| `description` | string | no | default `""`; one blurb per gig, shown under the gig-page heading (there are no per-image captions) |
| `cover` | string | yes | must match the `file` of one entry in `images` |
| `images` | object[] | yes | at least one entry; array order is **not** significant — the loader sorts by `file` name, which is the display order |
| `images[].file` | string | yes | filename as it exists in `originals/<slug>/`; unique within the gig |
| `images[].width` | integer | yes | original pixel width, > 0 |
| `images[].height` | integer | yes | original pixel height, > 0 |

No other fields are permitted (`additionalProperties: false`) — typos should fail
validation, not silently disappear.

## 2. `schema/gig.schema.json`

```json
{
  "$schema": "https://json-schema.org/draft-07/schema#",
  "$id": "https://pictures.elton.stoneman.io/schema/gig.schema.json",
  "title": "Gig",
  "type": "object",
  "required": ["slug", "title", "date", "venue", "location", "artists", "permission", "cover", "images"],
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },
    "slug": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$" },
    "title": { "type": "string", "minLength": 1 },
    "date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
    "venue": { "type": "string", "minLength": 1 },
    "location": { "type": "string", "minLength": 1 },
    "artists": { "type": "array", "items": { "type": "string", "minLength": 1 }, "minItems": 1 },
    "permission": { "enum": ["display-only", "editorial", "commercial"] },
    "description": { "type": "string", "default": "" },
    "cover": { "type": "string", "minLength": 1 },
    "images": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["file", "width", "height"],
        "additionalProperties": false,
        "properties": {
          "file": { "type": "string", "minLength": 1 },
          "width": { "type": "integer", "minimum": 1 },
          "height": { "type": "integer", "minimum": 1 }
        }
      }
    }
  }
}
```

Gig files should start with `"$schema": "../schema/gig.schema.json"` so VS Code
validates and autocompletes as the user authors them (`new-gig.ps1` writes this).

## 3. `scripts/lib/gigs.mjs`

Hand-rolled validation (no ajv dependency — the schema file is for editors; runtime
checks mirror it). Reference implementation:

```javascript
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";

const PERMISSIONS = ["display-only", "editorial", "commercial"];

/** Validate one parsed gig object. Returns [] when valid. */
export function validateGig(gig, fileName) {
  const errors = [];
  const err = (m) => errors.push(`${fileName}: ${m}`);

  for (const f of ["slug", "title", "date", "venue", "location", "cover"]) {
    if (typeof gig[f] !== "string" || gig[f].length === 0) err(`missing or empty "${f}"`);
  }
  if (gig.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(gig.slug)) err(`invalid slug "${gig.slug}"`);
  if (gig.slug && basename(fileName, ".json") !== gig.slug)
    err(`slug "${gig.slug}" does not match file name`);
  if (gig.date && !/^\d{4}-\d{2}-\d{2}$/.test(gig.date)) err(`invalid date "${gig.date}"`);
  if (!Array.isArray(gig.artists) || gig.artists.length === 0) err(`"artists" must be a non-empty array`);
  if (!PERMISSIONS.includes(gig.permission))
    err(`"permission" must be one of ${PERMISSIONS.join(", ")}`);

  if (!Array.isArray(gig.images) || gig.images.length === 0) {
    err(`"images" must be a non-empty array`);
  } else {
    const seen = new Set();
    for (const [i, img] of gig.images.entries()) {
      if (typeof img.file !== "string" || img.file.length === 0) err(`images[${i}]: missing "file"`);
      if (seen.has(img.file)) err(`images[${i}]: duplicate file "${img.file}"`);
      seen.add(img.file);
      if (!Number.isInteger(img.width) || img.width < 1) err(`images[${i}]: invalid "width"`);
      if (!Number.isInteger(img.height) || img.height < 1) err(`images[${i}]: invalid "height"`);
    }
    if (gig.cover && !seen.has(gig.cover)) err(`cover "${gig.cover}" is not in images`);
  }
  return errors;
}

/** Load all gigs from a directory, throw with every problem listed, sort newest first. */
export async function loadGigs(dir = "gigs") {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const gigs = [];
  const errors = [];
  for (const file of files) {
    let gig;
    try {
      gig = JSON.parse(await readFile(join(dir, file), "utf8"));
    } catch (e) {
      errors.push(`${file}: invalid JSON — ${e.message}`);
      continue;
    }
    errors.push(...validateGig(gig, file));
    gig.description ??= "";
    gig.images?.sort((a, b) => a.file.localeCompare(b.file));   // display order = filename sort
    gigs.push(gig);
  }
  if (errors.length) throw new Error(`Gig validation failed:\n  ${errors.join("\n  ")}`);
  return gigs.sort((a, b) => b.date.localeCompare(a.date));
}
```

Design points:
- **Collect all errors, then throw once** — the user fixes a whole file in one pass.
- `description` is defaulted to `""` at load time so consumers never null-check it.
- Image display order is imposed here (filename sort, ≈ capture order for camera
  files) so no consumer depends on hand-maintained JSON order.
- Gig sorting is a plain string compare on `date` (ISO dates sort lexically).
- The optional `$schema` key in gig files is ignored by `validateGig` (skip it when
  checking for unknown fields, if unknown-field checking is added).

## 4. Test plan

Runner: `node --test` (built in, no dependency). Test file: `scripts/lib/gigs.test.mjs`,
using fixture gig objects inline and a temp dir (`fs.mkdtemp`) for `loadGigs` cases.

| Case | Expect |
|---|---|
| valid gig object | `validateGig` → `[]` |
| slug `"Summer Fest!"` | error mentioning slug |
| slug not matching filename | error |
| date `"21/06/2026"` | error |
| `permission: "public"` | error listing allowed values |
| `cover` not present in `images` | error |
| duplicate `images[].file` | error |
| `images: []` | error |
| missing `description` | valid; loaded gig has `description === ""` |
| images authored out of name order | loaded gig's `images` sorted by `file` |
| two gig files with dates 2026-06-21 and 2026-07-01 | `loadGigs` returns 07-01 first |
| one malformed-JSON file among valid files | `loadGigs` throws; message names the bad file |

Run: `node --test scripts/lib/` — all pass.

## 5. Acceptance criteria

- [ ] `node --test scripts/lib/` passes.
- [ ] A gig file with `"$schema": "../schema/gig.schema.json"` gets autocomplete and
      red squiggles for bad fields in VS Code.
- [ ] `loadGigs` output is stable and newest-first regardless of directory order.
