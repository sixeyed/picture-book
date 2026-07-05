import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Eleventy from "@11ty/eleventy";

// src/_data/gigs.js resolves "gigs" relative to process.cwd(), and imports
// scripts/lib/gigs.mjs relative to its own file location, so a full build
// needs a self-contained workspace: copies of src/, scripts/lib/gigs.mjs,
// schema/ and eleventy.config.mjs, plus a fixture gigs/ directory. Every
// test chdir's into a fresh temp workspace and chdir's back afterwards so
// we never read the repo's real (empty) gigs/ or write into the repo.
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const projectCwd = process.cwd();

const EDITORIAL_GIG = {
  slug: "editorial-gig",
  title: "Editorial Gig",
  date: "2026-06-21",
  venue: "The Foundry",
  location: "Sheffield, UK",
  artists: ["The Editorial Band"],
  permission: "editorial",
  description: "An editorial blurb about the gig.",
  cover: "P1000001.jpg",
  images: [
    // deliberately out of filename order in the JSON array
    { file: "P1000002.jpg", width: 4000, height: 3000 },
    { file: "P1000001.jpg", width: 3000, height: 2000 },
  ],
};

const SPECIAL_CHARS_GIG = {
  slug: "special-chars-gig",
  title: 'Rock & Roll "Night"',
  date: "2024-03-01",
  venue: "The Cellar",
  location: "Manchester, UK",
  artists: ["The Ampersands"],
  permission: "editorial",
  cover: "P3000001.jpg",
  images: [{ file: "P3000001.jpg", width: 3000, height: 2000 }],
};

const DISPLAY_ONLY_GIG = {
  slug: "display-only-gig",
  title: "Display Only Gig",
  date: "2025-01-15",
  venue: "The Warehouse",
  location: "Leeds, UK",
  artists: ["The Display Band"],
  permission: "display-only",
  cover: "P2000001.jpg",
  images: [{ file: "P2000001.jpg", width: 5000, height: 3333 }],
};

async function withBuiltSite(fn) {
  const dir = await mkdtemp(join(tmpdir(), "site-test-"));
  try {
    await cp(join(repoRoot, "src"), join(dir, "src"), { recursive: true });
    await cp(join(repoRoot, "eleventy.config.mjs"), join(dir, "eleventy.config.mjs"));
    await mkdir(join(dir, "scripts", "lib"), { recursive: true });
    await cp(join(repoRoot, "scripts", "lib", "gigs.mjs"), join(dir, "scripts", "lib", "gigs.mjs"));
    await cp(join(repoRoot, "schema"), join(dir, "schema"), { recursive: true });
    await mkdir(join(dir, "gigs"), { recursive: true });
    await writeFile(join(dir, "gigs", `${EDITORIAL_GIG.slug}.json`), JSON.stringify(EDITORIAL_GIG));
    await writeFile(join(dir, "gigs", `${DISPLAY_ONLY_GIG.slug}.json`), JSON.stringify(DISPLAY_ONLY_GIG));
    await writeFile(join(dir, "gigs", `${SPECIAL_CHARS_GIG.slug}.json`), JSON.stringify(SPECIAL_CHARS_GIG));

    process.chdir(dir);
    try {
      const elev = new Eleventy("src", "build", { configPath: "eleventy.config.mjs" });
      await elev.write();
    } finally {
      process.chdir(projectCwd);
    }

    await fn(dir);
  } finally {
    process.chdir(projectCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

async function readBuild(dir, relPath) {
  return readFile(join(dir, "build", relPath), "utf8");
}

test("site build: emits expected output files", async () => {
  await withBuiltSite(async (dir) => {
    await assert.doesNotReject(readBuild(dir, "index.html"));
    await assert.doesNotReject(readBuild(dir, "editorial-gig/index.html"));
    await assert.doesNotReject(readBuild(dir, "display-only-gig/index.html"));
    await assert.doesNotReject(readBuild(dir, "about/index.html"));
    await assert.doesNotReject(readBuild(dir, "assets/site.css"));
  });
});

test("home page: newer gig's card appears before older gig's", async () => {
  await withBuiltSite(async (dir) => {
    const html = await readBuild(dir, "index.html");
    const editorialIdx = html.indexOf("editorial-gig");
    const displayIdx = html.indexOf("display-only-gig");
    assert(editorialIdx >= 0 && displayIdx >= 0, "both gig links should appear on the home page");
    assert(editorialIdx < displayIdx, "newer gig (editorial-gig, 2026) should appear before older gig (display-only-gig, 2025)");
  });
});

test("home page: card shows cover thumb URL, title, venue and formatted date", async () => {
  await withBuiltSite(async (dir) => {
    const html = await readBuild(dir, "index.html");
    assert(html.includes("/thumbs/editorial-gig/P1000001.jpg"), "cover thumb URL for editorial gig");
    assert(html.includes("Editorial Gig"), "title");
    assert(html.includes("The Foundry"), "venue");
    assert(html.includes("21 June 2026"), "formatted date");
  });
});

test("gig page: one a.thumb per image, in filename order regardless of JSON array order", async () => {
  await withBuiltSite(async (dir) => {
    const html = await readBuild(dir, "editorial-gig/index.html");
    const thumbCount = (html.match(/class="thumb"/g) || []).length;
    assert.equal(thumbCount, 2, "expected one a.thumb per image");
    const idx1 = html.indexOf("P1000001.jpg");
    const idx2 = html.indexOf("P1000002.jpg");
    assert(idx1 >= 0 && idx2 >= 0);
    assert(idx1 < idx2, "P1000001.jpg (filename order) should appear before P1000002.jpg despite JSON array order");
  });
});

test("blurb: gig with description renders it, gig without description renders no blurb", async () => {
  await withBuiltSite(async (dir) => {
    const editorialHtml = await readBuild(dir, "editorial-gig/index.html");
    assert(editorialHtml.includes('<p class="blurb">An editorial blurb about the gig.</p>'));

    const displayHtml = await readBuild(dir, "display-only-gig/index.html");
    assert(!displayHtml.includes('class="blurb"'), "no blurb element when description is empty");
  });
});

test("gig page grid: markup contract matches overview §3.6 exactly", async () => {
  await withBuiltSite(async (dir) => {
    const html = await readBuild(dir, "editorial-gig/index.html");
    assert(html.includes('href="/img/web/editorial-gig/P1000001.jpg"'), "href points at web rendition");
    assert(html.includes('data-stem="P1000001"'), "data-stem has no extension");
    assert(html.includes('data-full="/img/full/editorial-gig/P1000001.jpg"'), "data-full points at full rendition");
    assert(html.includes("style=\"aspect-ratio: 3000 / 2000\""), "aspect-ratio style from width/height");
    assert(/<img src="\/thumbs\/editorial-gig\/P1000001\.jpg" alt="Editorial Gig"\s+width="\d+" height="\d+" loading="lazy" decoding="async">/.test(html), "img has width/height/loading/decoding");
  });
});

test("permission: editorial gig has data-download=true, display-only has data-download=false", async () => {
  await withBuiltSite(async (dir) => {
    const editorialHtml = await readBuild(dir, "editorial-gig/index.html");
    assert(editorialHtml.includes('data-download="true"'));

    const displayHtml = await readBuild(dir, "display-only-gig/index.html");
    assert(displayHtml.includes('data-download="false"'));
  });
});

test("OG tags: gig page has og:image ending /img/web/<slug>/<cover>", async () => {
  await withBuiltSite(async (dir) => {
    const html = await readBuild(dir, "editorial-gig/index.html");
    assert(/<meta property="og:image" content="[^"]*\/img\/web\/editorial-gig\/P1000001\.jpg"/.test(html));
  });
});

test("gallery script: present on gig pages, absent on home and about", async () => {
  await withBuiltSite(async (dir) => {
    const gigHtml = await readBuild(dir, "editorial-gig/index.html");
    assert(gigHtml.includes('src="/assets/gallery.js"'), "gig page should load gallery.js");
    assert(/<script[^>]*src="\/assets\/gallery\.js"[^>]*defer/.test(gigHtml), "gallery.js should be deferred");

    const homeHtml = await readBuild(dir, "index.html");
    assert(!homeHtml.includes("gallery.js"), "home page should not load gallery.js");

    const aboutHtml = await readBuild(dir, "about/index.html");
    assert(!aboutHtml.includes("gallery.js"), "about page should not load gallery.js");
  });
});

test("escaping: gig title with & and quotes is escaped exactly once in <title> and og:title", async () => {
  await withBuiltSite(async (dir) => {
    const html = await readBuild(dir, "special-chars-gig/index.html");
    assert(!html.includes("&amp;amp;"), "must not double-escape ampersands");
    assert(!html.includes("&amp;quot;"), "must not double-escape quotes");
    assert(/<title>Rock &amp; Roll (&quot;|")Night(&quot;|") — /.test(html), "title tag single-escaped");
    assert(/<meta property="og:title" content="Rock &amp; Roll &quot;Night&quot; — /.test(html), "og:title single-escaped");
  });
});
