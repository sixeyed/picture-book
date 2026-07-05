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
  if (!Array.isArray(gig.artists) || gig.artists.length === 0) {
    err(`"artists" must be a non-empty array`);
  } else {
    for (const [i, artist] of gig.artists.entries()) {
      if (typeof artist !== "string" || artist.length === 0) err(`artists[${i}]: must be a non-empty string`);
    }
  }
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
    const gigErrors = validateGig(gig, file);
    errors.push(...gigErrors);
    // Only apply normalization if this gig has no validation errors
    if (gigErrors.length === 0) {
      gig.description ??= "";
      gig.images?.sort((a, b) => a.file.localeCompare(b.file));   // display order = filename sort
    }
    gigs.push(gig);
  }
  if (errors.length) throw new Error(`Gig validation failed:\n  ${errors.join("\n  ")}`);
  return gigs.sort((a, b) => b.date.localeCompare(a.date));
}
