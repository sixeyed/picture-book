import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, stat, utimes, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { run } from "./build-images.mjs";

// build-images.mjs resolves gigs/originals/build/.r2-stage relative to
// process.cwd(), so every test chdir's into a fresh temp workspace and
// chdir's back afterwards (see comment in build-images.mjs for why).
const projectCwd = process.cwd();

async function withWorkspace(fn) {
  const dir = await mkdtemp(join(tmpdir(), "build-images-"));
  await mkdir(join(dir, "gigs"), { recursive: true });
  await mkdir(join(dir, "originals"), { recursive: true });
  process.chdir(dir);
  try {
    await fn(dir);
  } finally {
    process.chdir(projectCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

function makeGig(overrides = {}) {
  return {
    slug: "test-gig",
    title: "Test Gig",
    date: "2026-06-21",
    venue: { name: "The Foundry", location: "Sheffield, UK" },
    artists: [{ name: "The Example Band" }],
    permission: "editorial",
    cover: "P1000001.jpg",
    images: [
      { file: "P1000001.jpg", width: 3000, height: 2000 },
      { file: "P1000002.jpg", width: 3000, height: 2000 },
    ],
    ...overrides,
  };
}

async function writeGig(gig) {
  await writeFile(join("gigs", `${gig.slug}.json`), JSON.stringify(gig));
}

async function originalPath(slug, file) {
  await mkdir(join("originals", slug), { recursive: true });
  return join("originals", slug, file);
}

async function make3000x2000(slug, file) {
  const p = await originalPath(slug, file);
  await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: { r: 100, g: 150, b: 200 } },
  }).jpeg().toFile(p);
  return p;
}

async function make400x300(slug, file) {
  const p = await originalPath(slug, file);
  await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 50, g: 200, b: 80 } },
  }).jpeg().toFile(p);
  return p;
}

async function makeRotated(slug, file) {
  const p = await originalPath(slug, file);
  await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: { r: 10, g: 20, b: 30 } },
  }).withMetadata({ orientation: 6 }).jpeg().toFile(p);
  return p;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

test("fresh build, editorial gig: thumb + web + full exist for each image, correct long edges", async () => {
  await withWorkspace(async () => {
    const gig = makeGig();
    await writeGig(gig);
    await make3000x2000(gig.slug, "P1000001.jpg");
    await make3000x2000(gig.slug, "P1000002.jpg");

    const result = await run([]);
    assert.equal(result.exitCode, 0);

    for (const file of ["P1000001.jpg", "P1000002.jpg"]) {
      const thumbPath = join("build", "thumbs", gig.slug, file);
      const webPath = join(".r2-stage", "web", gig.slug, file);
      const fullPath = join(".r2-stage", "full", gig.slug, file);
      assert.ok(await exists(thumbPath), `${thumbPath} should exist`);
      assert.ok(await exists(webPath), `${webPath} should exist`);
      assert.ok(await exists(fullPath), `${fullPath} should exist`);

      const srcBytes = await readFile(join("originals", gig.slug, file));
      const fullBytes = await readFile(fullPath);
      assert.ok(srcBytes.equals(fullBytes), "full rendition should be byte-identical to the original");

      const thumbMeta = await sharp(thumbPath).metadata();
      assert.equal(Math.max(thumbMeta.width, thumbMeta.height), 600, "thumb long edge should be 600");

      const webMeta = await sharp(webPath).metadata();
      assert.equal(Math.max(webMeta.width, webMeta.height), 2048, "web long edge should be 2048");
    }
  });
});

test("display-only gig: no .r2-stage/full/<slug>/ created", async () => {
  await withWorkspace(async () => {
    const gig = makeGig({ permission: "display-only" });
    await writeGig(gig);
    await make3000x2000(gig.slug, "P1000001.jpg");
    await make3000x2000(gig.slug, "P1000002.jpg");

    const result = await run([]);
    assert.equal(result.exitCode, 0);

    assert.ok(!(await exists(join(".r2-stage", "full", gig.slug))), "full dir should not exist");
    assert.ok(await exists(join("build", "thumbs", gig.slug, "P1000001.jpg")));
    assert.ok(await exists(join(".r2-stage", "web", gig.slug, "P1000001.jpg")));
  });
});

test("400x300 source: thumb output remains 400x300 (no upscale)", async () => {
  await withWorkspace(async () => {
    const gig = makeGig({ images: [{ file: "small.jpg", width: 400, height: 300 }], cover: "small.jpg" });
    await writeGig(gig);
    await make400x300(gig.slug, "small.jpg");

    const result = await run([]);
    assert.equal(result.exitCode, 0);

    const thumbMeta = await sharp(join("build", "thumbs", gig.slug, "small.jpg")).metadata();
    assert.equal(thumbMeta.width, 400);
    assert.equal(thumbMeta.height, 300);
  });
});

test("EXIF orientation 6 source: output width/height are the rotated dimensions", async () => {
  await withWorkspace(async () => {
    const gig = makeGig({ images: [{ file: "rotated.jpg", width: 2000, height: 3000 }], cover: "rotated.jpg" });
    await writeGig(gig);
    await makeRotated(gig.slug, "rotated.jpg");

    const result = await run([]);
    assert.equal(result.exitCode, 0);

    const thumbMeta = await sharp(join("build", "thumbs", gig.slug, "rotated.jpg")).metadata();
    // Raw pixels are 3000x2000 but orientation 6 rotates 90deg on display,
    // so the baked output should be portrait (narrower than it is tall).
    assert.ok(thumbMeta.height > thumbMeta.width, "rotated thumb should be portrait");
    assert.equal(Math.max(thumbMeta.width, thumbMeta.height), 600);
  });
});

test("second run, nothing changed: zero files regenerated", async () => {
  await withWorkspace(async () => {
    const gig = makeGig();
    await writeGig(gig);
    await make3000x2000(gig.slug, "P1000001.jpg");
    await make3000x2000(gig.slug, "P1000002.jpg");

    await run([]);
    const thumbPath = join("build", "thumbs", gig.slug, "P1000001.jpg");
    const before = (await stat(thumbPath)).mtimeMs;

    const result = await run([]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.counts.thumb, 0, "no thumbs should be regenerated");
    assert.equal(result.counts.web, 0, "no web renditions should be regenerated");
    assert.equal(result.counts.full, 0, "no full copies should be regenerated");

    const after = (await stat(thumbPath)).mtimeMs;
    assert.equal(after, before, "thumb mtime should be unchanged");
  });
});

test("source touched (utimes newer): only that image's renditions regenerate", async () => {
  await withWorkspace(async () => {
    const gig = makeGig();
    await writeGig(gig);
    const src1 = await make3000x2000(gig.slug, "P1000001.jpg");
    await make3000x2000(gig.slug, "P1000002.jpg");

    await run([]);
    const thumb1 = join("build", "thumbs", gig.slug, "P1000001.jpg");
    const thumb2 = join("build", "thumbs", gig.slug, "P1000002.jpg");
    const before1 = (await stat(thumb1)).mtimeMs;
    const before2 = (await stat(thumb2)).mtimeMs;

    // Bump the mtime of source 1 into the future so it looks newer than its output.
    const future = new Date(Date.now() + 10_000);
    await utimes(src1, future, future);

    const result = await run([]);
    assert.equal(result.counts.thumb, 1, "only one thumb should regenerate");

    const after1 = (await stat(thumb1)).mtimeMs;
    const after2 = (await stat(thumb2)).mtimeMs;
    assert.ok(after1 > before1, "touched image's thumb should regenerate");
    assert.equal(after2, before2, "untouched image's thumb should be unchanged");
  });
});

test("image listed in JSON but file missing: exit 1, message names originals/<slug>/<file>", async () => {
  await withWorkspace(async () => {
    const gig = makeGig();
    await writeGig(gig);
    await make3000x2000(gig.slug, "P1000001.jpg");
    // P1000002.jpg deliberately not created

    const result = await run([]);
    assert.equal(result.exitCode, 1);
    assert.match(result.message, /originals\/test-gig\/P1000002\.jpg/);
  });
});

test("image removed from JSON, staged file exists: staged file removed on next run", async () => {
  await withWorkspace(async () => {
    const gig = makeGig();
    await writeGig(gig);
    await make3000x2000(gig.slug, "P1000001.jpg");
    await make3000x2000(gig.slug, "P1000002.jpg");
    await run([]);

    const thumbPath = join("build", "thumbs", gig.slug, "P1000002.jpg");
    const webPath = join(".r2-stage", "web", gig.slug, "P1000002.jpg");
    const fullPath = join(".r2-stage", "full", gig.slug, "P1000002.jpg");
    assert.ok(await exists(thumbPath));

    // Remove the image from the gig JSON (file on disk may remain in originals/).
    const updatedGig = makeGig({
      images: [{ file: "P1000001.jpg", width: 3000, height: 2000 }],
      cover: "P1000001.jpg",
    });
    await writeGig(updatedGig);

    const result = await run([]);
    assert.equal(result.exitCode, 0);
    assert.ok(!(await exists(thumbPath)), "orphaned thumb should be removed");
    assert.ok(!(await exists(webPath)), "orphaned web rendition should be removed");
    assert.ok(!(await exists(fullPath)), "orphaned full copy should be removed");
  });
});

test("permission editorial -> display-only: .r2-stage/full/<slug>/ removed on next run", async () => {
  await withWorkspace(async () => {
    const gig = makeGig();
    await writeGig(gig);
    await make3000x2000(gig.slug, "P1000001.jpg");
    await make3000x2000(gig.slug, "P1000002.jpg");
    await run([]);

    assert.ok(await exists(join(".r2-stage", "full", gig.slug)));

    await writeGig(makeGig({ permission: "display-only" }));
    const result = await run([]);
    assert.equal(result.exitCode, 0);
    assert.ok(!(await exists(join(".r2-stage", "full", gig.slug))), "full dir should be removed");
  });
});

test("--gig <slug>: other gigs' images untouched", async () => {
  await withWorkspace(async () => {
    const gigA = makeGig({ slug: "gig-a" });
    const gigB = makeGig({ slug: "gig-b" });
    await writeGig(gigA);
    await writeGig(gigB);
    await make3000x2000("gig-a", "P1000001.jpg");
    await make3000x2000("gig-a", "P1000002.jpg");
    await make3000x2000("gig-b", "P1000001.jpg");
    await make3000x2000("gig-b", "P1000002.jpg");

    const result = await run(["--gig", "gig-a"]);
    assert.equal(result.exitCode, 0);

    assert.ok(await exists(join("build", "thumbs", "gig-a", "P1000001.jpg")));
    assert.ok(!(await exists(join("build", "thumbs", "gig-b"))), "gig-b thumbs dir should not exist");
    assert.ok(!(await exists(join(".r2-stage", "web", "gig-b"))), "gig-b web dir should not exist");
  });
});

test("metadata check: web rendition has no EXIF block", async () => {
  await withWorkspace(async () => {
    const gig = makeGig({ images: [{ file: "rotated.jpg", width: 2000, height: 3000 }], cover: "rotated.jpg" });
    await writeGig(gig);
    await makeRotated(gig.slug, "rotated.jpg");

    await run([]);

    const webMeta = await sharp(join(".r2-stage", "web", gig.slug, "rotated.jpg")).metadata();
    assert.equal(webMeta.exif, undefined);
  });
});

test("missing gigs dir / invalid gig JSON: loadGigs error propagates as exit 1", async () => {
  await withWorkspace(async () => {
    await writeFile(join("gigs", "broken.json"), "{ not json");
    const result = await run([]);
    assert.equal(result.exitCode, 1);
    assert.match(result.message, /broken\.json/);
  });
});

test("corrupt source jpeg: exit 1, message names the file, other images still processed", async () => {
  await withWorkspace(async () => {
    const gig = makeGig();
    await writeGig(gig);
    await make3000x2000(gig.slug, "P1000001.jpg");
    // "jpeg" that is actually garbage bytes - sharp will throw on it
    const badPath = await originalPath(gig.slug, "P1000002.jpg");
    await writeFile(badPath, Buffer.from("this is definitely not a jpeg"));

    const result = await run([]);
    assert.equal(result.exitCode, 1);
    assert.match(result.message, /test-gig\/P1000002\.jpg/, "failure message should name the corrupt file");

    // The healthy image's renditions were still produced.
    assert.ok(await exists(join("build", "thumbs", gig.slug, "P1000001.jpg")));
    assert.ok(await exists(join(".r2-stage", "web", gig.slug, "P1000001.jpg")));
    assert.ok(await exists(join(".r2-stage", "full", gig.slug, "P1000001.jpg")));
  });
});
