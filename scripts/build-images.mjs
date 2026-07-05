#!/usr/bin/env node
// Generates thumb/web/full renditions for every image of every gig (component 3).
//
// Paths (gigs/, originals/, build/, .r2-stage/) are resolved relative to
// process.cwd() rather than import.meta.url. That lets tests process.chdir()
// into a temp workspace and exercise the pipeline in full isolation.
import { copyFile, mkdir, stat, rm, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { loadGigs } from "./lib/gigs.mjs";

const CONCURRENCY = 4;

// thumb/web share the same resize+reencode pipeline; full is a byte-for-byte copy.
const RENDITIONS = [
  { name: "thumb", edge: 600, quality: 80, dir: (slug) => join("build", "thumbs", slug) },
  { name: "web", edge: 2048, quality: 85, dir: (slug) => join(".r2-stage", "web", slug) },
];

function fullDir(slug) {
  return join(".r2-stage", "full", slug);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Incremental rule: skip if the output already exists and is at least as new
// as its source. No content hashing — mtime comparison only.
async function isFresh(src, dest) {
  try {
    const [srcStat, destStat] = await Promise.all([stat(src), stat(dest)]);
    return destStat.mtimeMs >= srcStat.mtimeMs;
  } catch {
    return false;
  }
}

async function generateRendition(src, dest, edge, quality) {
  await mkdir(dirname(dest), { recursive: true });
  await sharp(src)
    .rotate() // bakes in EXIF orientation, then the tag is dropped
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true }) // no .withMetadata() -> GPS/EXIF stripped
    .toFile(dest);
}

async function processImage(gig, img, counts) {
  const src = join("originals", gig.slug, img.file);

  for (const r of RENDITIONS) {
    const dest = join(r.dir(gig.slug), img.file);
    if (await isFresh(src, dest)) continue;
    await generateRendition(src, dest, r.edge, r.quality);
    counts[r.name]++;
  }

  if (gig.permission !== "display-only") {
    const dest = join(fullDir(gig.slug), img.file);
    if (!(await isFresh(src, dest))) {
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest); // never re-encode originals
      counts.full++;
    }
  }
}

// Simple bounded worker pool over a shared iterator - no dependency needed.
async function runPool(items, worker, concurrency) {
  const iterator = items[Symbol.iterator]();
  const size = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (const item of iterator) await worker(item);
    })
  );
}

// Removes outputs that no longer correspond to the current gig JSON:
// - drops the whole full/ dir when a gig is (or has become) display-only
//   (this only stops the local .r2-stage/full/ from being re-uploaded on the
//   next rclone copy - rclone copy never deletes remotely, so any full/
//   objects already pushed to R2 for this gig stay live until the manual
//   prune - see component 7)
// - removes individual thumb/web(/full) files for images no longer listed
async function cleanupStale(gig) {
  const keep = new Set(gig.images.map((i) => i.file));
  const dirs = [RENDITIONS[0].dir(gig.slug), RENDITIONS[1].dir(gig.slug)];

  if (gig.permission === "display-only") {
    await rm(fullDir(gig.slug), { recursive: true, force: true });
  } else {
    dirs.push(fullDir(gig.slug));
  }

  for (const dir of dirs) {
    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      continue; // dir doesn't exist yet - nothing to clean
    }
    await Promise.all(
      entries.filter((f) => !keep.has(f)).map((f) => rm(join(dir, f), { force: true }))
    );
  }
}

/**
 * Run the rendition pipeline. Returns { exitCode, message, counts } rather
 * than calling process.exit, so tests can invoke it in-process after
 * chdir'ing into a fixture workspace.
 */
export async function run(argv = []) {
  const gigIdx = argv.indexOf("--gig");
  const gigFilter = gigIdx !== -1 ? argv[gigIdx + 1] : null;

  let gigs;
  try {
    gigs = await loadGigs("gigs");
  } catch (e) {
    return { exitCode: 1, message: e.message };
  }

  if (gigFilter) gigs = gigs.filter((g) => g.slug === gigFilter);

  // Missing source is a hard error - collect every missing file across every
  // gig first so one run reports the full extent of JSON/folder drift.
  const missing = [];
  for (const gig of gigs) {
    for (const img of gig.images) {
      const src = join("originals", gig.slug, img.file);
      if (!(await exists(src))) missing.push(src);
    }
  }
  if (missing.length) {
    return { exitCode: 1, message: `Missing source file(s):\n  ${missing.join("\n  ")}` };
  }

  const jobs = [];
  for (const gig of gigs) for (const img of gig.images) jobs.push({ gig, img });

  // Same collect-report-exit-1 pattern as missing sources: a failed image
  // (corrupt JPEG, I/O error) is recorded and the remaining images finish,
  // so one run reports every problem.
  const failures = [];
  const counts = { thumb: 0, web: 0, full: 0 };
  await runPool(
    jobs,
    async ({ gig, img }) => {
      try {
        await processImage(gig, img, counts);
      } catch (e) {
        failures.push(`${gig.slug}/${img.file}: ${e.message}`);
      }
    },
    CONCURRENCY
  );

  for (const gig of gigs) {
    try {
      await cleanupStale(gig);
    } catch (e) {
      failures.push(`${gig.slug}: cleanup failed - ${e.message}`);
    }
  }

  if (failures.length) {
    return { exitCode: 1, message: `Image processing failed:\n  ${failures.join("\n  ")}`, counts };
  }

  const applicable = gigs.reduce(
    (sum, g) => sum + g.images.length * (g.permission === "display-only" ? 2 : 3),
    0
  );
  const generated = counts.thumb + counts.web + counts.full;
  const upToDate = applicable - generated;
  const message =
    `${gigs.length} gigs, ${jobs.length} images: ` +
    `${counts.thumb} thumbs, ${counts.web} web, ${counts.full} full generated; ` +
    `${upToDate} up to date.`;

  return { exitCode: 0, message, counts };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { exitCode, message } = await run(process.argv.slice(2));
  if (exitCode === 0) console.log(message);
  else console.error(message);
  process.exitCode = exitCode;
}
