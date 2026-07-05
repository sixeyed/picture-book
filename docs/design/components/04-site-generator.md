# Component 4 — Site Generator: Eleventy Config, Data Layer, Templates

Renders the static HTML: home page (gig cards), one page per gig, about page.
Eleventy v3 (ESM) with Nunjucks templates.

**Files:**
- Create: `eleventy.config.mjs`
- Create: `package.json` (exact content in overview §3.1)
- Create: `src/_data/gigs.js`
- Create: `src/_data/site.js`
- Create: `src/_layouts/base.njk`
- Create: `src/index.njk`, `src/gig.njk`, `src/about.njk`

**Interfaces:**
- Consumes: `loadGigs()` from `scripts/lib/gigs.mjs`; URL scheme and markup contract
  from overview §3.2/§3.6.
- Produces: HTML in `build/`; the gallery markup contract that `gallery.js`
  (component 5) binds to; passthrough-copied `build/assets/*`.

---

## 1. `eleventy.config.mjs`

```javascript
export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "schema": "schema" });

  // Human-readable date for display: 2026-06-21 -> "21 June 2026"
  eleventyConfig.addFilter("displayDate", (iso) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB",
      { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }));

  return {
    dir: { input: "src", output: "build", layouts: "_layouts", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
```

`build/thumbs/` is written by component 3, not Eleventy; Eleventy must never clean
the output directory (it doesn't by default — do not add a clean step).

## 2. Data layer

### `src/_data/gigs.js`

```javascript
import { loadGigs } from "../../scripts/lib/gigs.mjs";

const THUMB_EDGE = 600;

export default async function () {
  const gigs = await loadGigs("gigs");
  for (const gig of gigs) {
    for (const img of gig.images) {
      img.stem = img.file.replace(/\.[^.]+$/, "");
      const scale = Math.min(1, THUMB_EDGE / Math.max(img.width, img.height));
      img.thumbWidth = Math.round(img.width * scale);
      img.thumbHeight = Math.round(img.height * scale);
    }
    gig.coverImage = gig.images.find((i) => i.file === gig.cover);
  }
  return gigs;
}
```

Computed fields consumed by templates and by the markup contract: `stem`,
`thumbWidth`, `thumbHeight`, `coverImage`. The thumb-dimension rounding here must
match sharp's `fit: "inside"` rounding closely enough for layout (they may differ by
1 px; the `aspect-ratio` style on the anchor is what actually controls layout, so
this is acceptable).

### `src/_data/site.js`

```javascript
export default {
  name: "Elton Stoneman — Gig Photography",
  url: "https://pictures.elton.stoneman.io",
  intro: "Live-music photography. Shot from the crowd and the pit.",
  email: "elton@sixeyed.com",
  instagram: "https://instagram.com/TODO",
};
```

All user-facing copy lives here (single edit point; values marked TODO for review).

## 3. Templates

### `src/_layouts/base.njk`

- `<!doctype html>`, `lang="en-GB"`, dark `<meta name="color-scheme" content="dark">`.
- `<title>{{ title }} — {{ site.name }}</title>` (home uses just `site.name`).
- Open Graph: `og:title`, `og:type=website`, `og:url` (`site.url + page.url`),
  and `og:image` — provided by pages via an `ogImage` variable; gig pages set it to
  `{{ site.url }}/img/web/{{ gig.slug }}/{{ gig.cover }}` (the 2048 px rendition —
  social scrapers can fetch it through the Function).
- Links `assets/site.css`; loads `assets/gallery.js` with `defer` **only** on gig
  pages (pages set `needsGallery: true`).
- Minimal header: site name (links home) + `About` link. Footer: © year, Instagram.

### `src/index.njk` — home

Front matter: `layout: base.njk`, `permalink: /`.

```njk
<p class="intro">{{ site.intro }}</p>
<ul class="cards">
  {% for gig in gigs %}
  <li>
    <a href="/{{ gig.slug }}/">
      <img src="/thumbs/{{ gig.slug }}/{{ gig.cover }}" alt="{{ gig.title }}"
           width="{{ gig.coverImage.thumbWidth }}" height="{{ gig.coverImage.thumbHeight }}"
           loading="lazy" decoding="async">
      <h2>{{ gig.title }}</h2>
      <p>{{ gig.venue }} · {{ gig.date | displayDate }}</p>
    </a>
  </li>
  {% endfor %}
</ul>
```

`gigs` is already newest-first from the data layer — no sorting in templates.

### `src/gig.njk` — one page per gig (pagination)

Front matter — use Eleventy's `---js` front matter, NOT YAML template strings.
(A YAML `title: "{{ gig.title }}"` gets rendered-and-autoescaped once at
computed-data time and again by base.njk's `{{ title }}`, double-escaping any
`&`/quotes in gig titles — found and fixed in review.)

```javascript
---js
{
  layout: "base.njk",
  pagination: { data: "gigs", size: 1, alias: "gig" },
  permalink: (data) => `/${data.gig.slug}/`,
  eleventyComputed: {
    title: (data) => data.gig.title,
    needsGallery: true,
    ogImage: (data) => `${data.site.url}/img/web/${data.gig.slug}/${data.gig.cover}`,
  },
}
---
```

Body: heading block (`title`, artists joined with ` · `, `venue`, `location`,
`date | displayDate`), then `<p class="blurb">{{ gig.description }}</p>` when
non-empty, then the gallery grid **exactly per the markup contract in overview
§3.6** (`ul.grid[data-download]` → `a.thumb[data-stem][data-full]` → `img` with
dimensions and `loading="lazy"`; image order comes pre-sorted from the loader).
This markup is the interface with component 5 — any change must be agreed in the
overview first.

### `src/about.njk`

Front matter: `layout: base.njk`, `permalink: /about/`, `title: About`.
Short bio paragraph (placeholder copy referencing `site.*`), `mailto:` link from
`site.email`, Instagram link from `site.instagram`.

## 4. Test plan

Template output is verified by building fixtures rather than unit-testing Nunjucks.
Add test file `scripts/site.test.mjs` (runner: `node --test`) that:

1. Creates a temp workspace with two fixture gigs (one `editorial`, one
   `display-only`; distinct dates) and runs Eleventy programmatically
   (`import Eleventy from "@11ty/eleventy"`) with input/output pointed at temp dirs.
2. Asserts on the emitted HTML (plain string/regex checks are sufficient):

| Case | Expect |
|---|---|
| output files | `index.html`, `<slug>/index.html` ×2, `about/index.html`, `assets/site.css` |
| home order | newer gig's card appears before older gig's |
| card fields | cover thumb URL, title, venue, "21 June 2026" formatted date |
| gig page grid | one `a.thumb` per image, in filename order regardless of JSON array order |
| blurb | gig with `description` renders it under the heading; empty description renders no blurb element |
| markup contract | `href="/img/web/<slug>/<file>"`, `data-stem` without extension, `style="aspect-ratio: W / H"`, `img` has `width`/`height`/`loading="lazy"` |
| permission | editorial gig: `data-download="true"`; display-only: `data-download="false"` |
| OG tags | gig page has `og:image` ending `/img/web/<slug>/<cover>` |
| gallery script | present on gig pages, absent on home/about |

## 5. Acceptance criteria

- [ ] `node --test scripts/site.test.mjs` passes.
- [ ] `npx @11ty/eleventy` over real content exits 0; pages render correctly in a
      browser via `npx wrangler pages dev build` (thumbs load; lightbox links 404
      until R2 has content — expected locally, see component 6 for local R2 dev).
