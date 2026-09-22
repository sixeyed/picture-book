import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { scoreAspect, targetSize, caption, run } from "./insta-export.mjs";

const projectCwd = process.cwd();

// Instagram feed accepts 4:5 (0.8) through 1.91:1; 4:5 is the ideal. Lower
// score = closer. Aspect is width / height.
test("scoreAspect: ranks 2:3 portrait and near-square ahead of 3:2 landscape, panorama last", () => {
  const s = (w, h) => scoreAspect(w / h);
  assert(s(4008, 6008) < s(6008, 4008), "2:3 portrait beats 3:2 landscape");
  assert(s(2948, 3040) < s(6008, 4008), "near-square beats 3:2 landscape");
  assert(s(6008, 4008) < s(4105, 1907), "3:2 landscape beats a 2.15:1 panorama");
  assert.equal(s(4, 5), 0, "4:5 is the ideal");
});

test("targetSize: 4:5 crop for tall portraits, resize-only inside the range, 1.91:1 crop for panoramas", () => {
  assert.deepEqual(targetSize(4008, 6008), { width: 1080, height: 1350, crop: true });
  assert.deepEqual(targetSize(6008, 4008), { width: 1080, height: 720, crop: false });
  assert.deepEqual(targetSize(3000, 3000), { width: 1080, height: 1080, crop: false });
  assert.deepEqual(targetSize(4105, 1907), { width: 1080, height: 565, crop: true });
});

test("caption: default template names artists, venue, date and links the gig page", () => {
  const text = caption({
    slug: "sirom-hidden-notes-2609",
    title: "Širom",
    date: "2026-09-19",
    venue: { name: "St Laurence Church", location: "Stroud, UK" },
    artists: [{ name: "Širom" }],
  });
  assert.match(text, /^Širom at St Laurence Church, Stroud · 19 September 2026/);
  assert(text.includes("pictures.sixeyed.com/sirom-hidden-notes-2609"), "links the gig page");
  assert(text.includes("#gigphotography"), "carries the standing hashtags");
});

async function withWorkspace(fn) {
  const dir = await mkdtemp(join(tmpdir(), "insta-"));
  process.chdir(dir);
  try {
    await mkdir("gigs");
    await mkdir(join("originals", "test-gig"), { recursive: true });
    const make = (file, width, height) =>
      sharp({ create: { width, height, channels: 3, background: { r: 40, g: 40, b: 60 } } })
        .jpeg().toFile(join("originals", "test-gig", file));
    await make("P1.jpg", 1200, 1800); // 2:3 portrait  -> crop to 4:5
    await make("P2.jpg", 1800, 1200); // 3:2 landscape -> resize only
    await make("P3.jpg", 2200, 1000); // panorama      -> crop to 1.91:1
    await writeFile(join("gigs", "test-gig.json"), JSON.stringify({
      slug: "test-gig", title: "Test Gig", date: "2026-09-19",
      venue: { name: "The Venue", location: "Stroud, UK" },
      artists: [{ name: "Test Gig" }], permission: "display-only", cover: "P2.jpg",
      images: [
        { file: "P2.jpg", width: 1800, height: 1200 },
        { file: "P1.jpg", width: 1200, height: 1800 },
        { file: "P3.jpg", width: 2200, height: 1000 },
      ],
    }));
    await fn(dir);
  } finally {
    process.chdir(projectCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

test("run: exports every image at Instagram size, ranked index.json and caption.txt", async () => {
  await withWorkspace(async () => {
    const result = await run(["test-gig"]);
    assert.deepEqual(result.map((r) => r.file), ["P1.jpg", "P2.jpg", "P3.jpg"], "ranked best-fit first");

    const dims = async (f) => { const m = await sharp(join("insta", "test-gig", f)).metadata(); return [m.width, m.height]; };
    assert.deepEqual(await dims("P1.jpg"), [1080, 1350]);
    assert.deepEqual(await dims("P2.jpg"), [1080, 720]);
    assert.deepEqual(await dims("P3.jpg"), [1080, 565]);

    const index = JSON.parse(await readFile(join("insta", "test-gig", "index.json"), "utf8"));
    assert.equal(index[0].file, "P1.jpg");
    assert.equal(index[0].crop, true);
    assert.equal(index[1].crop, false);

    const text = await readFile(join("insta", "test-gig", "caption.txt"), "utf8");
    assert(text.includes("pictures.sixeyed.com/test-gig"));
  });
});

test("run: unknown slug throws a clear error", async () => {
  await withWorkspace(async () => {
    await assert.rejects(run(["nope"]), /no gig "nope"/);
  });
});
