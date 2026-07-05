import test from "node:test";
import assert from "node:assert";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateGig, loadGigs } from "./gigs.mjs";

test("validateGig: valid gig object returns empty errors array", () => {
  const gig = {
    slug: "summer-fest-2026",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    description: "Great event",
    cover: "P1000063.jpg",
    images: [
      { file: "P1000063.jpg", width: 6000, height: 4000 }
    ]
  };
  const errors = validateGig(gig, "summer-fest-2026.json");
  assert.deepEqual(errors, []);
});

test("validateGig: invalid slug with capital letter and special char", () => {
  const gig = {
    slug: "Summer Fest!",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }]
  };
  const errors = validateGig(gig, "temp.json");
  assert(errors.some(e => e.includes("slug")), "Should have error mentioning slug");
});

test("validateGig: slug not matching filename", () => {
  const gig = {
    slug: "one-slug",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }]
  };
  const errors = validateGig(gig, "different-slug.json");
  assert(errors.some(e => e.includes("does not match")), "Should error about slug mismatch");
});

test("validateGig: invalid date format", () => {
  const gig = {
    slug: "summer-fest",
    title: "Summer Festival",
    date: "21/06/2026",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }]
  };
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("invalid date")), "Should error about date format");
});

test("validateGig: invalid permission value", () => {
  const gig = {
    slug: "summer-fest",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "public",
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }]
  };
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("display-only") && e.includes("editorial") && e.includes("commercial")),
    "Should list allowed permission values");
});

test("validateGig: cover not in images", () => {
  const gig = {
    slug: "summer-fest",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "missing.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }]
  };
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("cover") && e.includes("not in images")), "Should error about cover not in images");
});

test("validateGig: duplicate images file", () => {
  const gig = {
    slug: "summer-fest",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [
      { file: "P1000063.jpg", width: 6000, height: 4000 },
      { file: "P1000063.jpg", width: 6000, height: 4000 }
    ]
  };
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("duplicate")), "Should error about duplicate file");
});

test("validateGig: empty images array", () => {
  const gig = {
    slug: "summer-fest",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: []
  };
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("images")), "Should error about empty images array");
});

test("validateGig: missing description defaults to empty string", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gigs-"));
  const gig = {
    slug: "summer-fest",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }]
  };
  const errors = validateGig(gig, "summer-fest.json");
  assert.deepEqual(errors, [], "Gig without description should be valid");
});

test("loadGigs: images authored out of order are sorted by filename", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gigs-"));
  const gigData = {
    slug: "summer-fest",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [
      { file: "P1000065.jpg", width: 6000, height: 4000 },
      { file: "P1000063.jpg", width: 6000, height: 4000 },
      { file: "P1000064.jpg", width: 6000, height: 4000 }
    ]
  };
  await writeFile(join(dir, "summer-fest.json"), JSON.stringify(gigData));

  const [loaded] = await loadGigs(dir);
  const fileNames = loaded.images.map(img => img.file);
  assert.deepEqual(fileNames, ["P1000063.jpg", "P1000064.jpg", "P1000065.jpg"],
    "Images should be sorted by filename");
});

test("loadGigs: multiple gigs sorted newest first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gigs-"));

  const gig1 = {
    slug: "june-gig",
    title: "June Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }]
  };

  const gig2 = {
    slug: "july-gig",
    title: "July Festival",
    date: "2026-07-01",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }]
  };

  await writeFile(join(dir, "june-gig.json"), JSON.stringify(gig1));
  await writeFile(join(dir, "july-gig.json"), JSON.stringify(gig2));

  const gigs = await loadGigs(dir);
  assert.equal(gigs[0].date, "2026-07-01", "Newest date should be first");
  assert.equal(gigs[1].date, "2026-06-21", "Older date should be second");
});

test("loadGigs: malformed JSON file throws with filename", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gigs-"));

  const goodGig = {
    slug: "good-gig",
    title: "Good Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }]
  };

  await writeFile(join(dir, "good-gig.json"), JSON.stringify(goodGig));
  await writeFile(join(dir, "bad-gig.json"), "{ invalid json }");

  try {
    await loadGigs(dir);
    assert.fail("Should have thrown");
  } catch (e) {
    assert(e.message.includes("bad-gig.json"), "Error message should name the bad file");
    assert(e.message.includes("invalid JSON"), "Error message should mention invalid JSON");
  }
});

test("validateGig: missing required fields", () => {
  const gig = {
    slug: "summer-fest",
    title: "Summer Festival",
    // missing date
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }]
  };
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("date")), "Should error about missing date");
});

test("validateGig: missing artists array", () => {
  const gig = {
    slug: "summer-fest",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    // missing artists
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }]
  };
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("artists")), "Should error about missing artists");
});

test("validateGig: empty artists array", () => {
  const gig = {
    slug: "summer-fest",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: [],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }]
  };
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("artists")), "Should error about empty artists array");
});

test("validateGig: invalid image dimensions", () => {
  const gig = {
    slug: "summer-fest",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 0, height: 4000 }]
  };
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("width")), "Should error about invalid width");
});

test("loadGigs: loaded gig has description defaulted to empty string", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gigs-"));
  const gigData = {
    slug: "summer-fest",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }]
  };
  await writeFile(join(dir, "summer-fest.json"), JSON.stringify(gigData));

  const [loaded] = await loadGigs(dir);
  assert.equal(loaded.description, "", "Description should default to empty string");
});

test("validateGig: all valid permission values accepted", () => {
  const baseGig = {
    slug: "summer-fest",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }]
  };

  for (const permission of ["display-only", "editorial", "commercial"]) {
    const gig = { ...baseGig, permission };
    const errors = validateGig(gig, "summer-fest.json");
    assert.deepEqual(errors, [], `Permission "${permission}" should be valid`);
  }
});

test("validateGig: invalid image file missing", () => {
  const gig = {
    slug: "summer-fest",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: "The Foundry",
    location: "Sheffield, UK",
    artists: ["The Example Band"],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [{ width: 6000, height: 4000 }]
  };
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("file")), "Should error about missing file in image");
});
