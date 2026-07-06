import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";

const PERMISSIONS = ["display-only", "editorial", "commercial"];
export const DEFAULT_COLUMNS = 3;

/** Validate an optional links array ([{ label, url }]). */
function validateLinks(links, path, err) {
  if (links === undefined) return;
  if (!Array.isArray(links)) {
    err(`${path}: "links" must be an array`);
    return;
  }
  for (const [i, link] of links.entries()) {
    if (typeof link?.label !== "string" || link.label.length === 0)
      err(`${path}.links[${i}]: missing or empty "label"`);
    if (typeof link?.url !== "string" || link.url.length === 0)
      err(`${path}.links[${i}]: missing or empty "url"`);
  }
}

/** Validate one parsed gig object. Returns [] when valid. */
export function validateGig(gig, fileName) {
  const errors = [];
  const err = (m) => errors.push(`${fileName}: ${m}`);

  for (const f of ["slug", "title", "date", "cover"]) {
    if (typeof gig[f] !== "string" || gig[f].length === 0) err(`missing or empty "${f}"`);
  }
  if (gig.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(gig.slug)) err(`invalid slug "${gig.slug}"`);
  if (gig.slug && basename(fileName, ".json") !== gig.slug)
    err(`slug "${gig.slug}" does not match file name`);
  if (gig.date && !/^\d{4}-\d{2}-\d{2}$/.test(gig.date)) err(`invalid date "${gig.date}"`);

  // venue: { name, location, links? }
  if (typeof gig.venue !== "object" || gig.venue === null || Array.isArray(gig.venue)) {
    err(`"venue" must be an object with "name" and "location"`);
  } else {
    if (typeof gig.venue.name !== "string" || gig.venue.name.length === 0) err(`venue: missing "name"`);
    if (typeof gig.venue.location !== "string" || gig.venue.location.length === 0)
      err(`venue: missing "location"`);
    validateLinks(gig.venue.links, "venue", err);
  }

  // artists: [{ name, links? }]
  if (!Array.isArray(gig.artists) || gig.artists.length === 0) {
    err(`"artists" must be a non-empty array`);
  } else {
    for (const [i, artist] of gig.artists.entries()) {
      if (typeof artist !== "object" || artist === null || Array.isArray(artist)) {
        err(`artists[${i}]: must be an object with "name"`);
      } else {
        if (typeof artist.name !== "string" || artist.name.length === 0) err(`artists[${i}]: missing "name"`);
        validateLinks(artist.links, `artists[${i}]`, err);
      }
    }
  }

  if (!PERMISSIONS.includes(gig.permission))
    err(`"permission" must be one of ${PERMISSIONS.join(", ")}`);

  // layout: { columns, widths? } — optional; drives the valid range for image columns
  let columns = DEFAULT_COLUMNS;
  if (gig.layout !== undefined) {
    if (typeof gig.layout !== "object" || gig.layout === null || Array.isArray(gig.layout)) {
      err(`"layout" must be an object`);
    } else {
      if (!Number.isInteger(gig.layout.columns) || gig.layout.columns < 1) {
        err(`layout: "columns" must be an integer >= 1`);
      } else {
        columns = gig.layout.columns;
      }
      if (gig.layout.widths !== undefined) {
        if (!Array.isArray(gig.layout.widths) || gig.layout.widths.length !== columns) {
          err(`layout: "widths" must be an array of length ${columns}`);
        } else if (!gig.layout.widths.every((w) => typeof w === "number" && w > 0)) {
          err(`layout: "widths" entries must be positive numbers`);
        }
      }
    }
  }

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
      if (img.column !== undefined && (!Number.isInteger(img.column) || img.column < 0 || img.column >= columns))
        err(`images[${i}]: "column" must be an integer between 0 and ${columns - 1}`);
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
    // Array order IS display order (both stack order within a column and the
    // lightbox next/prev sequence). Only default optional fields when valid.
    if (gigErrors.length === 0) gig.description ??= "";
    gigs.push(gig);
  }
  if (errors.length) throw new Error(`Gig validation failed:\n  ${errors.join("\n  ")}`);
  return gigs.sort((a, b) => b.date.localeCompare(a.date));
}
