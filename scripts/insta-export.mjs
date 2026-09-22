#!/usr/bin/env node
// Prepares a gig's photos for Instagram: ranks every image by how close its
// aspect is to Instagram's ideal, exports each one at feed size to insta/<slug>/,
// and writes a ranked index.json plus a caption.txt from the default template.
// Posting is manual — see .claude/skills/insta/SKILL.md.
//
// Paths (gigs/, originals/, insta/) resolve against process.cwd(), like
// build-images.mjs, so tests can chdir into a temp workspace.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { loadGigs } from "./lib/gigs.mjs";

// Instagram feed accepts width/height from 4:5 up to 1.91:1; 4:5 fills the most
// screen so it is the ideal. Exports are 1080 wide (Instagram's native width).
export const MIN_ASPECT = 4 / 5;
export const MAX_ASPECT = 1.91;
const WIDTH = 1080;
const QUALITY = 90;
const SITE = "pictures.sixeyed.com";
const HASHTAGS = "#gigphotography #livemusic #stroud";

/** Distance from the 4:5 ideal in log space, so 2:3 (needs a 17% crop) ranks
 *  just ahead of 1:1 and well ahead of 3:2; a panorama ranks last. 0 = ideal. */
export function scoreAspect(aspect) {
  return Math.abs(Math.log(aspect / MIN_ASPECT));
}

/** Output size for an original: crop tall portraits to 4:5 and panoramas to
 *  1.91:1; anything already inside the range is only resized. */
export function targetSize(width, height) {
  const aspect = width / height;
  const clamped = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, aspect));
  return { width: WIDTH, height: Math.round(WIDTH / clamped), crop: clamped !== aspect };
}

const displayDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Default caption: who, where, when; link to the full set; standing hashtags. */
export function caption(gig) {
  const artists = gig.artists.map((a) => a.name).join(" · ");
  const town = gig.venue.location.split(",")[0].trim();
  return [
    `${artists} at ${gig.venue.name}, ${town} · ${displayDate(gig.date)}`,
    "",
    `Full set: ${SITE}/${gig.slug}`,
    "",
    HASHTAGS,
  ].join("\n") + "\n";
}

export async function run(argv = []) {
  const [slug] = argv;
  if (!slug) throw new Error("usage: insta-export.mjs <slug>");
  const gig = (await loadGigs("gigs")).find((g) => g.slug === slug);
  if (!gig) throw new Error(`no gig "${slug}" in gigs/`);

  const outDir = join("insta", slug);
  await mkdir(outDir, { recursive: true });

  const ranked = gig.images
    .map((img) => ({ file: img.file, width: img.width, height: img.height, score: scoreAspect(img.width / img.height), ...targetSize(img.width, img.height) }))
    .sort((a, b) => a.score - b.score);

  for (const r of ranked) {
    // Attention-based positioning keeps the busiest part of the frame (usually
    // the performer) when a crop is needed; in-range images just resize.
    await sharp(join("originals", slug, r.file))
      .rotate()
      .resize({ width: r.width, height: r.height, fit: "cover", position: sharp.strategy.attention })
      .jpeg({ quality: QUALITY })
      .toFile(join(outDir, r.file));
  }

  await writeFile(join(outDir, "index.json"), JSON.stringify(ranked, null, 2) + "\n");
  await writeFile(join(outDir, "caption.txt"), caption(gig));
  return ranked;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  run(process.argv.slice(2))
    .then((ranked) => {
      for (const r of ranked) console.log(`${r.file}  ${r.width}x${r.height}${r.crop ? "  (cropped)" : ""}`);
      console.log(`-> insta/${ranked.length ? process.argv[2] : ""}/ (index.json, caption.txt)`);
    })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
