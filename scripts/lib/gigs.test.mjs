import test from "node:test";
import assert from "node:assert";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateGig, loadGigs } from "./gigs.mjs";

function makeVenue(overrides = {}) {
  return { name: "The Foundry", location: "Sheffield, UK", ...overrides };
}

function makeArtist(overrides = {}) {
  return { name: "The Example Band", ...overrides };
}

function makeGig(overrides = {}) {
  return {
    slug: "summer-fest",
    title: "Summer Festival",
    date: "2026-06-21",
    venue: makeVenue(),
    artists: [makeArtist()],
    permission: "display-only",
    cover: "P1000063.jpg",
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000 }],
    ...overrides,
  };
}

test("validateGig: valid gig object returns empty errors array", () => {
  const gig = makeGig({ description: "Great event" });
  const errors = validateGig(gig, "summer-fest.json");
  assert.deepEqual(errors, []);
});

test("validateGig: invalid slug with capital letter and special char", () => {
  const gig = makeGig({ slug: "Summer Fest!" });
  const errors = validateGig(gig, "temp.json");
  assert(errors.some(e => e.includes("slug")), "Should have error mentioning slug");
});

test("validateGig: slug not matching filename", () => {
  const gig = makeGig({ slug: "one-slug" });
  const errors = validateGig(gig, "different-slug.json");
  assert(errors.some(e => e.includes("does not match")), "Should error about slug mismatch");
});

test("validateGig: invalid date format", () => {
  const gig = makeGig({ date: "21/06/2026" });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("invalid date")), "Should error about date format");
});

test("validateGig: invalid permission value", () => {
  const gig = makeGig({ permission: "public" });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("display-only") && e.includes("editorial") && e.includes("commercial")),
    "Should list allowed permission values");
});

test("validateGig: cover not in images", () => {
  const gig = makeGig({ cover: "missing.jpg" });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("cover") && e.includes("not in images")), "Should error about cover not in images");
});

test("validateGig: duplicate images file", () => {
  const gig = makeGig({
    images: [
      { file: "P1000063.jpg", width: 6000, height: 4000 },
      { file: "P1000063.jpg", width: 6000, height: 4000 },
    ],
  });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("duplicate")), "Should error about duplicate file");
});

test("validateGig: empty images array", () => {
  const gig = makeGig({ images: [] });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("images")), "Should error about empty images array");
});

test("validateGig: missing required fields", () => {
  const gig = makeGig();
  delete gig.date;
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("date")), "Should error about missing date");
});

test("validateGig: missing artists array", () => {
  const gig = makeGig();
  delete gig.artists;
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("artists")), "Should error about missing artists");
});

test("validateGig: empty artists array", () => {
  const gig = makeGig({ artists: [] });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("artists")), "Should error about empty artists array");
});

test("validateGig: invalid image dimensions", () => {
  const gig = makeGig({ images: [{ file: "P1000063.jpg", width: 0, height: 4000 }] });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("width")), "Should error about invalid width");
});

test("validateGig: all valid permission values accepted", () => {
  for (const permission of ["display-only", "editorial", "commercial"]) {
    const gig = makeGig({ permission });
    const errors = validateGig(gig, "summer-fest.json");
    assert.deepEqual(errors, [], `Permission "${permission}" should be valid`);
  }
});

test("validateGig: invalid image file missing", () => {
  const gig = makeGig({ images: [{ width: 6000, height: 4000 }] });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("file")), "Should error about missing file in image");
});

test("validateGig: venue not an object", () => {
  const gig = makeGig({ venue: "The Foundry" });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("venue")), "Should error about venue not being an object");
});

test("validateGig: venue missing name", () => {
  const gig = makeGig({ venue: { location: "Sheffield, UK" } });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("venue") && e.includes("name")), "Should error about missing venue name");
});

test("validateGig: venue missing location", () => {
  const gig = makeGig({ venue: { name: "The Foundry" } });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("venue") && e.includes("location")), "Should error about missing venue location");
});

test("validateGig: artist missing name", () => {
  const gig = makeGig({ artists: [{}] });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("artists[0]") && e.includes("name")), "Should error about missing artist name");
});

test("validateGig: artists entry not an object", () => {
  const gig = makeGig({ artists: ["The Example Band"] });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("artists[0]")), "Should error about artist entry not being an object");
});

test("validateGig: venue links entry missing label", () => {
  const gig = makeGig({ venue: makeVenue({ links: [{ url: "https://example.com" }] }) });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("venue.links[0]") && e.includes("label")), "Should error about missing link label");
});

test("validateGig: venue links entry missing url", () => {
  const gig = makeGig({ venue: makeVenue({ links: [{ label: "Website" }] }) });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("venue.links[0]") && e.includes("url")), "Should error about missing link url");
});

test("validateGig: venue links not an array", () => {
  const gig = makeGig({ venue: makeVenue({ links: "https://example.com" }) });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("venue") && e.includes("links") && e.includes("array")),
    "Should error about venue links not being an array");
});

test("validateGig: artist links entry missing label", () => {
  const gig = makeGig({ artists: [makeArtist({ links: [{ url: "https://example.com" }] })] });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("artists[0].links[0]") && e.includes("label")), "Should error about missing artist link label");
});

test("validateGig: artist links entry missing url", () => {
  const gig = makeGig({ artists: [makeArtist({ links: [{ label: "Website" }] })] });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("artists[0].links[0]") && e.includes("url")), "Should error about missing artist link url");
});

test("validateGig: artist links not an array", () => {
  const gig = makeGig({ artists: [makeArtist({ links: "https://example.com" })] });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("artists[0]") && e.includes("links") && e.includes("array")),
    "Should error about artist links not being an array");
});

test("validateGig: layout columns not integer >= 1", () => {
  const gig = makeGig({ layout: { columns: 0 } });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("layout") && e.includes("columns")), "Should error about invalid columns");
});

test("validateGig: layout widths wrong length", () => {
  const gig = makeGig({ layout: { columns: 3, widths: [1, 2] } });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("widths") && e.includes("length")), "Should error about widths length mismatch");
});

test("validateGig: layout widths with non-positive entry", () => {
  const gig = makeGig({ layout: { columns: 3, widths: [1, 0, 1] } });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("widths") && e.includes("positive")), "Should error about non-positive width");
});

test("validateGig: image column out of range for explicit layout", () => {
  const gig = makeGig({
    layout: { columns: 3 },
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000, column: 3 }],
  });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("images[0]") && e.includes("column")), "Should error about column out of range");
});

test("validateGig: negative image column is invalid", () => {
  const gig = makeGig({
    layout: { columns: 3 },
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000, column: -1 }],
  });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("images[0]") && e.includes("column")), "Should error about negative column");
});

test("validateGig: image column within range for explicit layout is valid", () => {
  const gig = makeGig({
    layout: { columns: 3 },
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000, column: 2 }],
  });
  const errors = validateGig(gig, "summer-fest.json");
  assert.deepEqual(errors, []);
});

test("validateGig: image column valid against DEFAULT_COLUMNS (3) when no layout present", () => {
  const gig = makeGig({
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000, column: 2 }],
  });
  const errors = validateGig(gig, "summer-fest.json");
  assert.deepEqual(errors, []);
});

test("validateGig: image column out of range against DEFAULT_COLUMNS (3) when no layout present", () => {
  const gig = makeGig({
    images: [{ file: "P1000063.jpg", width: 6000, height: 4000, column: 3 }],
  });
  const errors = validateGig(gig, "summer-fest.json");
  assert(errors.some(e => e.includes("images[0]") && e.includes("column")), "Should error about column out of default range");
});

test("loadGigs: images returned in authored array order, not filename order", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gigs-"));
  const gigData = makeGig({
    images: [
      // deliberately out of filename order — array order is authoritative
      { file: "P1000065.jpg", width: 6000, height: 4000 },
      { file: "P1000063.jpg", width: 6000, height: 4000 },
      { file: "P1000064.jpg", width: 6000, height: 4000 },
    ],
  });
  await writeFile(join(dir, "summer-fest.json"), JSON.stringify(gigData));

  const [loaded] = await loadGigs(dir);
  const fileNames = loaded.images.map(img => img.file);
  assert.deepEqual(fileNames, ["P1000065.jpg", "P1000063.jpg", "P1000064.jpg"],
    "Images should be returned in the authored order, not sorted by filename");
});

test("loadGigs: multiple gigs sorted newest first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gigs-"));

  const gig1 = makeGig({ slug: "june-gig", title: "June Festival", date: "2026-06-21" });
  const gig2 = makeGig({ slug: "july-gig", title: "July Festival", date: "2026-07-01" });

  await writeFile(join(dir, "june-gig.json"), JSON.stringify(gig1));
  await writeFile(join(dir, "july-gig.json"), JSON.stringify(gig2));

  const gigs = await loadGigs(dir);
  assert.equal(gigs[0].date, "2026-07-01", "Newest date should be first");
  assert.equal(gigs[1].date, "2026-06-21", "Older date should be second");
});

test("loadGigs: malformed JSON file throws with filename", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gigs-"));

  const goodGig = makeGig({ slug: "good-gig", title: "Good Festival" });

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

test("loadGigs: loaded gig has description defaulted to empty string", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gigs-"));
  const gigData = makeGig();
  await writeFile(join(dir, "summer-fest.json"), JSON.stringify(gigData));

  const [loaded] = await loadGigs(dir);
  assert.equal(loaded.description, "", "Description should default to empty string");
});

test("loadGigs: gig file with images as non-array throws aggregated error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gigs-"));

  const goodGig = makeGig({ slug: "good-gig", title: "Good Festival" });
  const badGig = makeGig({ slug: "bad-gig", title: "Bad Festival", date: "2026-07-01", images: "not-an-array" });

  await writeFile(join(dir, "good-gig.json"), JSON.stringify(goodGig));
  await writeFile(join(dir, "bad-gig.json"), JSON.stringify(badGig));

  try {
    await loadGigs(dir);
    assert.fail("Should have thrown");
  } catch (e) {
    assert(e.message.includes("Gig validation failed"), "Error should be aggregated validation error");
    assert(e.message.includes("bad-gig.json"), "Error message should name the bad file");
    assert(!e.message.includes("localeCompare"), "Error should not be TypeError from localeCompare");
  }
});

test("loadGigs: gig with image missing file throws aggregated error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gigs-"));

  const goodGig = makeGig({ slug: "good-gig", title: "Good Festival" });
  const badGig = makeGig({
    slug: "bad-gig",
    title: "Bad Festival",
    date: "2026-07-01",
    images: [
      { file: "P1000063.jpg", width: 6000, height: 4000 },
      { width: 6000, height: 4000 },
    ],
  });

  await writeFile(join(dir, "good-gig.json"), JSON.stringify(goodGig));
  await writeFile(join(dir, "bad-gig.json"), JSON.stringify(badGig));

  try {
    await loadGigs(dir);
    assert.fail("Should have thrown");
  } catch (e) {
    assert(e.message.includes("Gig validation failed"), "Error should be aggregated validation error");
    assert(e.message.includes("bad-gig.json"), "Error message should name the bad file");
    assert(!e.message.includes("localeCompare"), "Error should not be TypeError from localeCompare");
  }
});
